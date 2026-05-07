"""
POST /layer1/run — 4-step Layer 1 extraction pipeline.

1. Locate the uploaded .xlsx in the session's uploads dir (Step A source).
2. Run the 4-step extraction: header → AI column ID → full rows → AI hierarchy.
3. Run check_template() if company_id is provided.
4. Persist result to DB.
5. Return lineItems + structured + templateCheck.
"""
import json
import logging
from pathlib import Path

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

logger = logging.getLogger(__name__)

from app.config import UPLOADS_DIR
from app.db.database import get_db
from app.models.schemas import Layer1Request, Layer1Response
from app.services.layer1_service import get_layer1_service

router = APIRouter()


def _find_xlsx(session_dir: Path) -> Path:
    """Return path to the uploaded Excel file in the session directory."""
    for ext in ("original.xlsx", "original.xls"):
        p = session_dir / ext
        if p.exists():
            return p
    raise FileNotFoundError(
        f"No Excel file found in uploads session directory: {session_dir}"
    )


@router.post("/layer1/run", response_model=Layer1Response)
def run_layer1(
    request: Layer1Request,
    db: Session = Depends(get_db),
):
    """
    Run Layer 1 AI extraction for a single sheet using the 4-step pipeline.
    """
    if not request.sessionId or not request.sheetName or not request.sheetType:
        raise HTTPException(
            status_code=400,
            detail="sessionId, sheetName, and sheetType are required.",
        )

    # Locate uploaded file
    session_dir = UPLOADS_DIR / request.sessionId
    try:
        filepath = str(_find_xlsx(session_dir))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    # Run 4-step extraction
    service = get_layer1_service()
    try:
        result = service.run_extraction(
            sheet_type=request.sheetType,
            filepath=filepath,
            sheet_name=request.sheetName,
            reporting_period=request.reportingPeriod,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except anthropic.AuthenticationError:
        raise HTTPException(
            status_code=500,
            detail="Invalid Anthropic API key. Check ANTHROPIC_API_KEY in your .env file.",
        )
    except anthropic.RateLimitError:
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded. Please wait a moment and try again.",
        )
    except anthropic.APIError as e:
        raise HTTPException(status_code=502, detail=f"Claude API error: {e}")
    except ValueError as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse Claude response: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Check template if company_id available
    template_check = None
    company_id = request.companyId
    if company_id:
        try:
            structured_rows = result.get("structured", {}).get("rows", [])
            template_check = service.check_template(
                company_id=company_id,
                statement_type=request.sheetType.lower().replace(" ", "_"),
                structured_rows=structured_rows,
                db=db,
            )
        except Exception as exc:
            logger.warning("check_template failed for company %s: %s", company_id, exc)

    # Persist result to DB
    try:
        row = db.execute(
            text("SELECT layer1_data FROM reviews WHERE session_id = :sid"),
            {"sid": request.sessionId},
        ).fetchone()

        raw = row[0] if row else None
        if raw is None:
            existing = {}
        elif isinstance(raw, dict):
            existing = raw
        else:
            existing = json.loads(raw)

        existing[request.sheetName] = {
            "lineItems": result["lineItems"],
            "sourceScaling": result["sourceScaling"],
            "columnIdentified": result["columnIdentified"],
            "structured": result.get("structured"),
        }
        db.execute(
            text("UPDATE reviews SET layer1_data = :data WHERE session_id = :sid"),
            {"data": json.dumps(existing), "sid": request.sessionId},
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("Layer 1 DB persistence failed for session %s: %s", request.sessionId, exc)

    return Layer1Response(
        sheetName=request.sheetName,
        lineItems=result["lineItems"],
        sourceScaling=result["sourceScaling"],
        columnIdentified=result["columnIdentified"],
        structured=result.get("structured"),
        templateCheck=template_check,
    )
