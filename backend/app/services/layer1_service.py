"""
Layer 1 extraction orchestration service — 4-step pipeline.

Step A: Python extracts the first N header rows of the sheet.
Step B: AI identifies which column matches the reporting period.
Step C: Python extracts full rows with formatting metadata.
Step D: AI classifies rows into a nested hierarchy (structured JSON).

Also provides:
  check_template   — fuzzy-match extracted rows against a stored template.
  save_template    — upsert a template into layer1_templates.
"""
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session
from sqlalchemy import text as sa_text

from app.services.claude_service import ClaudeService, get_claude_service
from app.services.layer1_extractor import (
    extract_header_rows,
    extract_rows_with_metadata,
    rows_to_csv_with_metadata,
)

logger = logging.getLogger(__name__)

_VALID_TYPES = {"income_statement", "balance_sheet", "cash_flow_statement"}


class Layer1Service:
    """Orchestrates the 4-step Layer 1 extraction pipeline."""

    def __init__(self, claude: ClaudeService) -> None:
        self.claude = claude

    # ── Public: full pipeline ────────────────────────────────────────────────

    def run_extraction(
        self,
        sheet_type: str,
        filepath: str,
        sheet_name: str,
        reporting_period: str,
        shared_tab: bool = False,
    ) -> Dict[str, Any]:
        """
        Run the 4-step extraction pipeline for a single sheet.

        Returns:
            {
              lineItems: {label: float},   # flat dict for Layer 2 backward compat
              structured: {rows, waterfall?, validation_flags},
              sourceScaling: str,
              columnIdentified: str,
            }
        """
        model = os.getenv("LAYER1_MODEL", "claude-sonnet-4-6")
        normalized = sheet_type.lower().replace(" ", "_")
        if normalized not in _VALID_TYPES:
            raise ValueError(
                f"Unknown sheet_type '{sheet_type}'. "
                "Expected 'income_statement', 'balance_sheet', or 'cash_flow_statement'."
            )

        # ── Step A: header extraction ────────────────────────────────────────
        header_text = extract_header_rows(filepath, sheet_name, n_rows=150)

        # ── Step B: AI column identifier ─────────────────────────────────────
        # When multiple statements share the same tab, pass statement_type so
        # the AI can locate the correct section and return row boundaries.
        # For a dedicated single-statement tab, skip section detection entirely.
        col_prompt_vars: Dict[str, Any] = {
            "reporting_period": reporting_period,
            "header_rows": header_text,
            # Pass statement_type only for shared tabs so the AI locates the section.
            # Pass empty string for dedicated tabs so the AI skips section detection.
            "statement_type": normalized if shared_tab else "",
        }

        col_response = self.claude.call_claude(
            "layer1_column_identifier",
            col_prompt_vars,
            model,
            max_tokens=1024,
        )
        col_info = self.claude.parse_json_response(col_response)
        column_index: int = int(col_info.get("column_index", 1))
        source_scaling: str = str(col_info.get("source_scaling", "actual_dollars"))
        skip_rows: int = int(col_info.get("skip_rows", 0))
        column_identified: str = str(col_info.get("period_matched", col_info.get("column_letter", "")))

        # Section bounds only meaningful when shared_tab=True
        section_start_row: int = int(col_info.get("section_start_row", 0)) if shared_tab else 0
        section_end_row: int = int(col_info.get("section_end_row", 0)) if shared_tab else 0

        logger.info(
            "[Layer1] %s: col=%d scaling=%s shared=%s section=%s-%s",
            normalized, column_index, source_scaling, shared_tab,
            section_start_row or "auto", section_end_row or "end",
        )

        # ── Step C: full extraction with metadata ────────────────────────────
        rows = extract_rows_with_metadata(
            filepath,
            sheet_name,
            column_index=column_index,
            source_scaling=source_scaling,
            skip_rows=skip_rows,
            section_start_row=section_start_row,
            section_end_row=section_end_row,
        )
        rows_csv = rows_to_csv_with_metadata(rows)

        # ── Step D: AI hierarchy classification ──────────────────────────────
        struct_response = self.claude.call_claude(
            "layer1_structured_extractor",
            {
                "statement_type": normalized,
                "reporting_period": reporting_period,
                "rows_csv": rows_csv,
            },
            model,
            max_tokens=16384,
        )
        structured = self.claude.parse_json_response(struct_response)

        # Strip margin rows — margins are calculated outside this app
        if "rows" in structured:
            structured["rows"] = _strip_margins(structured["rows"])

        # ── Build flat lineItems from structured (backward compat for Layer 2) ─
        line_items = _flatten_structured(structured.get("rows", []))

        return {
            "lineItems": line_items,
            "structured": structured,
            "sourceScaling": source_scaling,
            "columnIdentified": column_identified,
        }

    # ── Public: template helpers ─────────────────────────────────────────────

    def check_template(
        self,
        company_id: int,
        statement_type: str,
        structured_rows: List[Dict],
        db: Session,
    ) -> Dict[str, Any]:
        """
        Load a stored template for this company/statement and fuzzy-match the
        extracted rows against it.

        Returns:
            {
              has_template: bool,
              matched: [...],        # rows that matched stored items
              unmatched: [...],      # rows not found in stored template
            }
        """
        row = db.execute(
            sa_text(
                "SELECT template FROM layer1_templates "
                "WHERE company_id = :cid AND statement_type = :st"
            ),
            {"cid": company_id, "st": statement_type},
        ).fetchone()

        if not row:
            return {"has_template": False, "matched": [], "unmatched": []}

        stored_template = row[0]
        if isinstance(stored_template, str):
            stored_template = json.loads(stored_template)

        stored_rows = stored_template.get("rows", [])
        stored_labels = {_normalize_label(r["label"]) for r in _iter_all_rows(stored_rows)}

        matched = []
        unmatched = []
        for r in _iter_all_rows(structured_rows):
            norm = _normalize_label(r["label"])
            if _fuzzy_matches(norm, stored_labels):
                matched.append(r)
            else:
                unmatched.append(r)

        return {
            "has_template": True,
            "matched": matched,
            "unmatched": unmatched,
        }

    def save_template(
        self,
        company_id: int,
        statement_type: str,
        template_json: Dict,
        db: Session,
    ) -> None:
        """Upsert a template into layer1_templates."""
        tmpl = json.dumps(template_json)
        result = db.execute(
            sa_text(
                "UPDATE layer1_templates SET template = :tmpl, updated_at = CURRENT_TIMESTAMP "
                "WHERE company_id = :cid AND statement_type = :st"
            ),
            {"tmpl": tmpl, "cid": company_id, "st": statement_type},
        )
        if result.rowcount == 0:
            db.execute(
                sa_text(
                    "INSERT INTO layer1_templates (company_id, statement_type, template) "
                    "VALUES (:cid, :st, :tmpl)"
                ),
                {"cid": company_id, "st": statement_type, "tmpl": tmpl},
            )
        db.commit()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _flatten_structured(rows: List[Dict], result: Optional[Dict] = None) -> Dict[str, float]:
    """Recursively flatten structured rows into {label: value} for Layer 2.
    Margin rows are excluded — they are calculated separately."""
    if result is None:
        result = {}
    for r in rows:
        if r.get("type") in ("individual", "sum"):
            val = r.get("value")
            if val is not None:
                try:
                    result[r["label"]] = float(val)
                except (TypeError, ValueError):
                    pass
        _flatten_structured(r.get("children", []), result)
    return result


def _strip_margins(rows: List[Dict]) -> List[Dict]:
    """Recursively remove margin-type rows from the structured tree."""
    cleaned = []
    for r in rows:
        if r.get("type") == "margin":
            continue
        cleaned.append({**r, "children": _strip_margins(r.get("children", []))})
    return cleaned


def _iter_all_rows(rows: List[Dict]):
    """Yield every node in a nested rows tree."""
    for r in rows:
        yield r
        yield from _iter_all_rows(r.get("children", []))


def _normalize_label(label: str) -> str:
    """Lowercase, strip punctuation/whitespace for fuzzy comparison."""
    return re.sub(r"[^a-z0-9]", "", label.lower())


def _fuzzy_matches(norm: str, stored_labels: set) -> bool:
    """
    High-confidence fuzzy match: exact normalized match OR within 1 character
    edit distance (handles caps/spacing differences only).
    """
    if norm in stored_labels:
        return True
    # 1-char tolerance for minor formatting differences
    for stored in stored_labels:
        if abs(len(norm) - len(stored)) > 2:
            continue
        if _levenshtein(norm, stored) <= 1:
            return True
    return False


def _levenshtein(a: str, b: str) -> int:
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        curr = [i]
        for j, cb in enumerate(b, 1):
            curr.append(min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = curr
    return prev[-1]


# ── Global singleton ──────────────────────────────────────────────────────────

_service: Optional[Layer1Service] = None


def get_layer1_service() -> Layer1Service:
    """Return the app-wide Layer1Service singleton."""
    global _service
    if _service is None:
        _service = Layer1Service(claude=get_claude_service())
    return _service
