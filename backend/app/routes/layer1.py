"""
POST /layer1/run          — enqueue async extraction job, returns { job_id } immediately (HTTP 202)
GET  /layer1/jobs/{job_id} — poll job status: pending | running | done | error

The extraction pipeline (2-5 Claude API calls, up to 8 minutes on complex sheets) runs
in a background daemon thread, decoupling job submission from completion and eliminating
Azure Container Apps' ~4-5 minute HTTP request timeout.
"""
import json
import logging
import threading
from pathlib import Path
from typing import Any, Dict, Optional

import anthropic
from fastapi import APIRouter, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.config import UPLOADS_DIR
from app.db.database import SessionLocal
from app.models.schemas import Layer1Request, Layer1Response
from app.services.layer1_service import get_layer1_service
from app.services.job_store import job_store

logger = logging.getLogger(__name__)
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


def _run_extraction_worker(
    job_id: str,
    session_id: str,
    sheet_name: str,
    sheet_type: str,
    reporting_period: str,
    filepath: str,
    company_id: Optional[int],
    shared_tab: bool,
) -> None:
    """
    Runs in a dedicated daemon thread. Creates its own DB session — the
    FastAPI request-scoped session is already closed by the time this runs.
    """
    job_store.set_running(job_id)
    db: Session = SessionLocal()
    try:
        service = get_layer1_service()

        # ── Extraction (the slow part: 2-5 Claude API calls) ─────────────────
        try:
            result = service.run_extraction(
                sheet_type=sheet_type,
                filepath=filepath,
                sheet_name=sheet_name,
                reporting_period=reporting_period,
                shared_tab=shared_tab,
            )
        except anthropic.AuthenticationError:
            job_store.set_error(job_id, "Invalid Anthropic API key.")
            return
        except anthropic.RateLimitError:
            job_store.set_error(job_id, "Rate limit exceeded. Please wait a moment and try again.")
            return
        except anthropic.APIError as e:
            job_store.set_error(job_id, f"Claude API error: {e}")
            return
        except FileNotFoundError as e:
            job_store.set_error(job_id, str(e))
            return
        except ValueError as e:
            job_store.set_error(job_id, f"Failed to parse Claude response: {e}")
            return
        except Exception as e:
            logger.exception("Layer1 worker unexpected error for job %s", job_id)
            job_store.set_error(job_id, str(e))
            return

        # ── Template check (non-fatal) ────────────────────────────────────────
        template_check = None
        if company_id:
            try:
                structured_rows = result.get("structured", {}).get("rows", [])
                template_check = service.check_template(
                    company_id=company_id,
                    statement_type=sheet_type.lower().replace(" ", "_"),
                    structured_rows=structured_rows,
                    db=db,
                )
            except Exception as exc:
                logger.warning(
                    "check_template failed for company %s in job %s: %s",
                    company_id, job_id, exc,
                )

        # ── DB persistence (non-fatal) ────────────────────────────────────────
        try:
            row = db.execute(
                text("SELECT layer1_data FROM reviews WHERE session_id = :sid"),
                {"sid": session_id},
            ).fetchone()

            raw = row[0] if row else None
            existing: Dict[str, Any] = (
                {} if raw is None
                else raw if isinstance(raw, dict)
                else json.loads(raw)
            )
            existing[sheet_name] = {
                "lineItems": result["lineItems"],
                "sourceScaling": result["sourceScaling"],
                "columnIdentified": result["columnIdentified"],
                "structured": result.get("structured"),
            }
            db.execute(
                text("""
                    UPDATE reviews
                    SET layer1_data = :data,
                        company_id = COALESCE(company_id, :cid)
                    WHERE session_id = :sid
                """),
                {"data": json.dumps(existing), "sid": session_id, "cid": company_id},
            )
            db.commit()
        except Exception as exc:
            db.rollback()
            logger.warning(
                "Layer1 DB persistence failed for session %s job %s: %s",
                session_id, job_id, exc,
            )

        # ── Store result ──────────────────────────────────────────────────────
        response = Layer1Response(
            sheetName=sheet_name,
            lineItems=result["lineItems"],
            sourceScaling=result["sourceScaling"],
            columnIdentified=result["columnIdentified"],
            structured=result.get("structured"),
            templateCheck=template_check,
            extractionDebug=result.get("extractionDebug"),
        )
        job_store.set_done(job_id, response.model_dump())

    except Exception as e:
        logger.exception("Unhandled error in extraction worker for job %s", job_id)
        job_store.set_error(job_id, f"Internal error: {e}")
    finally:
        db.close()


@router.post("/layer1/run", status_code=202)
def run_layer1(request: Layer1Request):
    """
    Enqueue a Layer 1 extraction job. Returns { job_id } immediately (HTTP 202).
    Poll GET /layer1/jobs/{job_id} for status and result.
    """
    if not request.sessionId or not request.sheetName or not request.sheetType:
        raise HTTPException(
            status_code=400,
            detail="sessionId, sheetName, and sheetType are required.",
        )

    # Validate file exists synchronously — fast, gives instant 404 on bad input
    session_dir = UPLOADS_DIR / request.sessionId
    try:
        filepath = str(_find_xlsx(session_dir))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    job_id = job_store.create_job()
    threading.Thread(
        target=_run_extraction_worker,
        args=(
            job_id,
            request.sessionId,
            request.sheetName,
            request.sheetType,
            request.reportingPeriod,
            filepath,
            request.companyId,
            request.sharedTab,
        ),
        daemon=True,
        name=f"layer1-worker-{job_id[:8]}",
    ).start()

    return {"job_id": job_id}


@router.get("/layer1/jobs/{job_id}")
def get_layer1_job(job_id: str):
    """
    Poll the status of a Layer 1 extraction job.

    Returns { job_id, status, result?, error? } where status is one of:
      pending | running | done | error

    When status == 'done', result is the full Layer1Response payload.
    When status == 'error', error is a human-readable string.
    """
    job = job_store.get(job_id)
    if job is None:
        raise HTTPException(
            status_code=404,
            detail=f"Job '{job_id}' not found. It may have expired (TTL: 10 minutes).",
        )
    return job
