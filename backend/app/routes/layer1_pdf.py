"""
POST /layer1/run-pdf — enqueue async PDF extraction job, returns { job_id } immediately (HTTP 202)

Reuses GET /layer1/jobs/{job_id} from layer1.py for polling (shared job_store singleton).
Fast I/O (read PDF, encode, load prompt) stays synchronous in the route handler for
instant input validation. Only the Claude API call runs in the background thread.
"""
import base64
import io
import json
import logging
import os
import threading

import anthropic
from fastapi import APIRouter, HTTPException
from pypdf import PdfReader, PdfWriter
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.config import UPLOADS_DIR, PROMPTS_DIR
from app.db.database import SessionLocal
from app.models.schemas import Layer1PdfRequest, Layer1Response
from app.services.claude_service import get_claude_service
from app.services.job_store import job_store

logger = logging.getLogger(__name__)
router = APIRouter()

_PROMPT_MAP = {
    "income_statement": "layer1_pdf_income_statement",
    "balance_sheet": "layer1_pdf_balance_sheet",
    "cash_flow_statement": "layer1_pdf_cash_flow_statement",
}


def _run_pdf_extraction_worker(
    job_id: str,
    session_id: str,
    pages: list,
    statement_type: str,
    reporting_period: str,
    pdf_base64: str,
    prompt_text: str,
) -> None:
    """
    Runs in a dedicated daemon thread. Creates its own DB session.
    pdf_base64 and prompt_text are pre-computed in the route handler to
    avoid file I/O in the background thread.
    """
    job_store.set_running(job_id)
    db: Session = SessionLocal()
    try:
        model = os.getenv("LAYER1_MODEL", "claude-sonnet-4-6")
        claude_service = get_claude_service()

        # ── Claude API call ───────────────────────────────────────────────────
        try:
            message = claude_service.client.messages.create(
                model=model,
                max_tokens=8192,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "document",
                                "source": {
                                    "type": "base64",
                                    "media_type": "application/pdf",
                                    "data": pdf_base64,
                                },
                            },
                            {
                                "type": "text",
                                "text": prompt_text,
                            },
                        ],
                    }
                ],
            )
        except anthropic.AuthenticationError:
            job_store.set_error(job_id, "Invalid Anthropic API key.")
            return
        except anthropic.RateLimitError:
            job_store.set_error(job_id, "Rate limit reached. Please wait and retry.")
            return
        except anthropic.APITimeoutError:
            job_store.set_error(job_id, "Extraction timed out. Please try again.")
            return
        except anthropic.APIError as e:
            job_store.set_error(job_id, f"Anthropic API error: {e}")
            return
        except Exception as e:
            logger.exception("PDF extraction worker unexpected error for job %s", job_id)
            job_store.set_error(job_id, str(e))
            return

        # ── Parse response ────────────────────────────────────────────────────
        response_text = message.content[0].text
        raw = claude_service.parse_json_response(response_text)

        if not isinstance(raw, dict):
            job_store.set_error(job_id, "Layer 1 PDF: expected a JSON object from Claude.")
            return

        raw_items = raw.get("line_items", {})
        if not isinstance(raw_items, dict):
            job_store.set_error(job_id, "Layer 1 PDF: 'line_items' must be a JSON object.")
            return

        clean_items = {}
        for label, value in raw_items.items():
            try:
                clean_items[str(label)] = float(value)
            except (TypeError, ValueError):
                continue

        result = {
            "lineItems": clean_items,
            "sourceScaling": str(raw.get("source_scaling", "unknown")),
            "columnIdentified": str(raw.get("column_identified", "unknown")),
        }

        # ── DB persistence (non-fatal) ────────────────────────────────────────
        try:
            row = db.execute(
                text("SELECT layer1_data FROM reviews WHERE session_id = :sid"),
                {"sid": session_id},
            ).fetchone()
            existing = json.loads(row[0]) if row and row[0] else {}
            existing[statement_type] = result
            db.execute(
                text("UPDATE reviews SET layer1_data = :data WHERE session_id = :sid"),
                {"data": json.dumps(existing), "sid": session_id},
            )
            db.commit()
        except Exception as exc:
            db.rollback()
            logger.warning(
                "Layer1 PDF DB persistence failed for session %s job %s: %s",
                session_id, job_id, exc,
            )

        # ── Store result ──────────────────────────────────────────────────────
        response = Layer1Response(
            sheetName=f"PDF pages {', '.join(str(p) for p in pages)}",
            lineItems=result["lineItems"],
            sourceScaling=result["sourceScaling"],
            columnIdentified=result["columnIdentified"],
        )
        job_store.set_done(job_id, response.model_dump())

    except Exception as e:
        logger.exception("Unhandled error in PDF extraction worker for job %s", job_id)
        job_store.set_error(job_id, f"Internal error: {e}")
    finally:
        db.close()


@router.post("/layer1/run-pdf", status_code=202)
def run_layer1_pdf(request: Layer1PdfRequest):
    """
    Enqueue a PDF Layer 1 extraction job. Returns { job_id } immediately (HTTP 202).
    Poll GET /layer1/jobs/{job_id} for status and result.
    """
    pdf_path = UPLOADS_DIR / request.sessionId / "original.pdf"
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="PDF not found for this session.")

    normalized = request.statementType.lower().replace(" ", "_")
    prompt_key = _PROMPT_MAP.get(normalized)
    if not prompt_key:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown statement type: {request.statementType}",
        )

    prompt_path = PROMPTS_DIR / f"{prompt_key}.md"
    if not prompt_path.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Prompt file {prompt_key}.md not found.",
        )

    # Encode PDF pages and load prompt synchronously — fast I/O,
    # and validates page numbers before handing off to the thread.
    reader = PdfReader(str(pdf_path))
    writer = PdfWriter()
    for page_num in request.pages:
        if page_num < 1 or page_num > len(reader.pages):
            raise HTTPException(
                status_code=400,
                detail=f"Page {page_num} is out of range (1-{len(reader.pages)}).",
            )
        writer.add_page(reader.pages[page_num - 1])

    pdf_buffer = io.BytesIO()
    writer.write(pdf_buffer)
    pdf_base64 = base64.standard_b64encode(pdf_buffer.getvalue()).decode("utf-8")
    prompt_text = prompt_path.read_text(encoding="utf-8").replace(
        "{reporting_period}", request.reportingPeriod
    )

    job_id = job_store.create_job()
    threading.Thread(
        target=_run_pdf_extraction_worker,
        args=(
            job_id,
            request.sessionId,
            request.pages,
            normalized,
            request.reportingPeriod,
            pdf_base64,
            prompt_text,
        ),
        daemon=True,
        name=f"layer1-pdf-worker-{job_id[:8]}",
    ).start()

    return {"job_id": job_id}
