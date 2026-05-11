"""
POST /layer1/run-pdf — Run Layer 1 AI extraction on selected PDF pages.
Uses the Claude API's native PDF document input.
"""
import base64
import io
import json
import os

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from pypdf import PdfReader, PdfWriter
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.config import UPLOADS_DIR, PROMPTS_DIR
from app.db.database import get_db
from app.models.schemas import Layer1PdfRequest, Layer1Response
from app.services.claude_service import get_claude_service

router = APIRouter()


@router.post("/layer1/run-pdf", response_model=Layer1Response)
def run_layer1_pdf(request: Layer1PdfRequest, db: Session = Depends(get_db)):
    """
    Run Layer 1 extraction on selected PDF pages.
    Sends the selected pages as a native PDF document to Claude.
    """
    pdf_path = UPLOADS_DIR / request.sessionId / "original.pdf"
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="PDF not found for this session.")

    # Extract selected pages into a new PDF
    reader = PdfReader(str(pdf_path))
    writer = PdfWriter()
    for page_num in request.pages:
        if page_num < 1 or page_num > len(reader.pages):
            raise HTTPException(
                status_code=400,
                detail=f"Page {page_num} is out of range (1-{len(reader.pages)}).",
            )
        writer.add_page(reader.pages[page_num - 1])  # 0-indexed internally

    # Write extracted pages to bytes
    pdf_buffer = io.BytesIO()
    writer.write(pdf_buffer)
    pdf_bytes = pdf_buffer.getvalue()
    pdf_base64 = base64.standard_b64encode(pdf_bytes).decode("utf-8")

    # Load the appropriate Layer 1 prompt
    prompt_map = {
        "income_statement": "layer1_pdf_income_statement",
        "balance_sheet": "layer1_pdf_balance_sheet",
        "cash_flow_statement": "layer1_pdf_cash_flow_statement",
    }
    normalized = request.statementType.lower().replace(" ", "_")
    prompt_key = prompt_map.get(normalized)
    if not prompt_key:
        raise HTTPException(status_code=400, detail=f"Unknown statement type: {request.statementType}")

    prompt_path = PROMPTS_DIR / f"{prompt_key}.md"
    if not prompt_path.exists():
        raise HTTPException(status_code=500, detail=f"Prompt file {prompt_key}.md not found.")

    prompt_text = prompt_path.read_text(encoding="utf-8")
    prompt_text = prompt_text.replace("{reporting_period}", request.reportingPeriod)

    # Call Claude with PDF as document input + text prompt
    model = os.getenv("LAYER1_MODEL", "claude-sonnet-4-6")
    claude_service = get_claude_service()

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
        raise HTTPException(status_code=401, detail="Invalid Anthropic API key.")
    except anthropic.RateLimitError:
        raise HTTPException(status_code=429, detail="Rate limit reached. Please wait and retry.")
    except anthropic.APITimeoutError:
        raise HTTPException(status_code=504, detail="Extraction timed out. Please try again.")
    except anthropic.APIError as e:
        raise HTTPException(status_code=502, detail=f"Anthropic API error: {e}")

    response_text = message.content[0].text
    raw = claude_service.parse_json_response(response_text)

    if not isinstance(raw, dict):
        raise HTTPException(status_code=500, detail="Layer 1: expected a JSON object from Claude.")

    raw_items = raw.get("line_items", {})
    if not isinstance(raw_items, dict):
        raise HTTPException(status_code=500, detail="Layer 1: 'line_items' must be a JSON object.")

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

    # Persist to DB (non-fatal)
    try:
        row = db.execute(
            text("SELECT layer1_data FROM reviews WHERE session_id = :sid"),
            {"sid": request.sessionId},
        ).fetchone()
        existing = json.loads(row[0]) if row and row[0] else {}
        existing[request.statementType] = result
        db.execute(
            text("UPDATE reviews SET layer1_data = :data WHERE session_id = :sid"),
            {"data": json.dumps(existing), "sid": request.sessionId},
        )
        db.commit()
    except Exception:
        db.rollback()

    return Layer1Response(
        sheetName=f"PDF pages {', '.join(str(p) for p in request.pages)}",
        lineItems=result["lineItems"],
        sourceScaling=result["sourceScaling"],
        columnIdentified=result["columnIdentified"],
    )
