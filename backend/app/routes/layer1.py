"""
POST /layer1/run — Full implementation.
Loads CSV from disk, calls the Layer 1 service, updates DB, returns extracted line items.
"""
import json

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.config import PROCESSED_DIR
from app.db.database import get_db
from app.models.schemas import Layer1Request, Layer1Response
from app.services.excel_processor import _safe_filename
from app.services.layer1_service import get_layer1_service

router = APIRouter()


@router.post("/layer1/run", response_model=Layer1Response)
async def run_layer1(
    request: Layer1Request,
    db: Session = Depends(get_db),
):
    """
    Run Layer 1 AI extraction for a single sheet.

    Steps:
    1. Load the CSV from processed/{sessionId}/{safe_sheet_name}.csv
    2. Call the Layer 1 service (Claude API with the appropriate prompt).
    3. Persist the result to the review's layer1_data in the database.
    4. Return the structured line items.
    """
    if not request.sessionId or not request.sheetName or not request.sheetType:
        raise HTTPException(
            status_code=400,
            detail="sessionId, sheetName, and sheetType are required.",
        )

    # Load CSV from disk
    safe_name = _safe_filename(request.sheetName)
    csv_path = PROCESSED_DIR / request.sessionId / f"{safe_name}.csv"

    if not csv_path.exists():
        raise HTTPException(
            status_code=404,
            detail=(
                f"CSV for sheet '{request.sheetName}' not found. "
                "Ensure the file was uploaded successfully first."
            ),
        )

    csv_content = csv_path.read_text(encoding="utf-8")

    # Run extraction via Claude
    service = get_layer1_service()
    try:
        result = service.run_extraction(
            sheet_type=request.sheetType,
            csv_content=csv_content,
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
        raise HTTPException(
            status_code=502,
            detail=f"Claude API error: {e}",
        )
    except ValueError as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to parse Claude response: {e}",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Update DB layer1_data (non-fatal)
    try:
        row = db.execute(
            text("SELECT layer1_data FROM reviews WHERE session_id = :sid"),
            {"sid": request.sessionId},
        ).fetchone()

        existing = json.loads(row[0]) if row and row[0] else {}
        existing[request.sheetName] = result
        db.execute(
            text("UPDATE reviews SET layer1_data = :data WHERE session_id = :sid"),
            {"data": json.dumps(existing), "sid": request.sessionId},
        )
        db.commit()
    except Exception:
        db.rollback()

    return Layer1Response(
        sheetName=request.sheetName,
        lineItems=result["lineItems"],
        sourceScaling=result["sourceScaling"],
        columnIdentified=result["columnIdentified"],
    )
