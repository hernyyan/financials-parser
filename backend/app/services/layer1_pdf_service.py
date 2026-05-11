"""
Layer 1 PDF extraction service.

Owns everything between receiving (session_id, pages, statement_type,
reporting_period) and returning a parsed result dict:

  - PDF page slicing + base64 encoding
  - Prompt file loading and period substitution
  - Claude API call (native PDF document input)
  - JSON response parsing and numeric coercion
  - DB persistence into reviews.layer1_data (non-fatal)

The route is left as a thin adapter: validate HTTP inputs → call this
service → return Layer1Response.
"""
import base64
import io
import json
import logging
import os
from typing import Any, Dict, List

from fastapi import HTTPException
from pypdf import PdfReader, PdfWriter
from sqlalchemy.orm import Session

from app.config import PROMPTS_DIR
from app.db.review_store import merge_layer1_data
from app.services.claude_service import ClaudeService
from app.utils.statement_meta import STATEMENT_KEYS_SET

logger = logging.getLogger(__name__)


class Layer1PdfService:
    def __init__(self, claude_service: ClaudeService) -> None:
        self._claude = claude_service

    # ── Public API ──────────────────────────────────────────────────────────

    def run_extraction(
        self,
        pdf_path: str,
        pages: List[int],
        statement_type: str,
        reporting_period: str,
        session_id: str,
        db: Session,
    ) -> Dict[str, Any]:
        """
        Extract Layer 1 line items from selected pages of a PDF.

        Returns a dict with keys:
          lineItems, sourceScaling, columnIdentified, sheetName
        """
        normalized = statement_type.lower().replace(" ", "_")
        if normalized not in STATEMENT_KEYS_SET:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown statement type: {statement_type}",
            )

        pdf_base64 = self._slice_and_encode(pdf_path, pages)
        prompt_text = self._load_prompt(normalized, reporting_period)

        model = os.getenv("LAYER1_MODEL", "claude-sonnet-4-6")
        response_text = self._call_claude(model, pdf_base64, prompt_text)
        result = self._parse_response(response_text, pages)

        self._persist(db, session_id, statement_type, result)

        return result

    # ── Private helpers ──────────────────────────────────────────────────────

    def _slice_and_encode(self, pdf_path: str, pages: List[int]) -> str:
        """Extract the requested pages from the PDF and return as base64."""
        reader = PdfReader(pdf_path)
        writer = PdfWriter()
        for page_num in pages:
            if page_num < 1 or page_num > len(reader.pages):
                raise HTTPException(
                    status_code=400,
                    detail=f"Page {page_num} is out of range (1-{len(reader.pages)}).",
                )
            writer.add_page(reader.pages[page_num - 1])
        buf = io.BytesIO()
        writer.write(buf)
        return base64.standard_b64encode(buf.getvalue()).decode("utf-8")

    def _load_prompt(self, normalized_type: str, reporting_period: str) -> str:
        """Load the Layer 1 PDF prompt file and substitute the reporting period."""
        prompt_key = f"layer1_pdf_{normalized_type}"
        prompt_path = PROMPTS_DIR / f"{prompt_key}.md"
        if not prompt_path.exists():
            raise HTTPException(
                status_code=500,
                detail=f"Prompt file {prompt_key}.md not found.",
            )
        return prompt_path.read_text(encoding="utf-8").replace(
            "{reporting_period}", reporting_period
        )

    def _call_claude(self, model: str, pdf_base64: str, prompt_text: str) -> str:
        """Send the PDF document + prompt to Claude and return the raw text response."""
        message = self._claude.client.messages.create(
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
                        {"type": "text", "text": prompt_text},
                    ],
                }
            ],
        )
        return message.content[0].text

    def _parse_response(
        self, response_text: str, pages: List[int]
    ) -> Dict[str, Any]:
        """Parse Claude's JSON response into the canonical Layer 1 result dict."""
        raw = self._claude.parse_json_response(response_text)
        if not isinstance(raw, dict):
            raise HTTPException(
                status_code=500,
                detail="Layer 1 PDF: expected a JSON object from Claude.",
            )
        raw_items = raw.get("line_items", {})
        if not isinstance(raw_items, dict):
            raise HTTPException(
                status_code=500,
                detail="Layer 1 PDF: 'line_items' must be a JSON object.",
            )
        clean_items: Dict[str, float] = {}
        for label, value in raw_items.items():
            try:
                clean_items[str(label)] = float(value)
            except (TypeError, ValueError):
                continue

        return {
            "lineItems": clean_items,
            "sourceScaling": str(raw.get("source_scaling", "unknown")),
            "columnIdentified": str(raw.get("column_identified", "unknown")),
            "sheetName": f"PDF pages {', '.join(str(p) for p in pages)}",
        }

    def _persist(
        self,
        db: Session,
        session_id: str,
        statement_type: str,
        result: Dict[str, Any],
    ) -> None:
        """Merge this result into reviews.layer1_data — non-fatal on failure."""
        try:
            merge_layer1_data(
                db,
                session_id,
                statement_type,
                {
                    "lineItems": result["lineItems"],
                    "sourceScaling": result["sourceScaling"],
                    "columnIdentified": result["columnIdentified"],
                },
            )
            db.commit()
        except Exception as exc:
            db.rollback()
            logger.warning(
                "Layer 1 PDF DB persistence failed for session %s: %s",
                session_id,
                exc,
            )


# Singleton factory — mirrors get_layer1_service()
_instance: Layer1PdfService | None = None


def get_layer1_pdf_service() -> Layer1PdfService:
    global _instance
    if _instance is None:
        from app.services.claude_service import get_claude_service
        _instance = Layer1PdfService(get_claude_service())
    return _instance
