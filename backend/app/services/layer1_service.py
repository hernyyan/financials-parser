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
    count_numeric_values_in_column,
    extract_header_rows,
    extract_rows_with_metadata,
    rows_to_csv_with_metadata,
)

logger = logging.getLogger(__name__)

_VALID_TYPES = {"income_statement", "balance_sheet", "cash_flow_statement"}

_COLUMN_IDENTIFIER_TOOL = {
    "name": "identify_column",
    "description": (
        "Identify the spreadsheet column containing the target reporting period "
        "and report data scaling and optional section boundaries."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "column_index":      {"type": "integer", "description": "1-based column index (A=1, B=2, ...)"},
            "column_letter":     {"type": "string",  "description": "Column letter (e.g. 'D')"},
            "source_scaling":    {"type": "string",  "enum": ["thousands", "millions", "actual_dollars"]},
            "skip_rows":         {"type": "integer", "description": "Number of header rows to skip before data begins"},
            "period_matched":    {"type": "string",  "description": "The header text that matched the target period"},
            "section_start_row": {"type": "integer", "description": "First data row of the section (0 if not applicable)"},
            "section_end_row":   {"type": "integer", "description": "Last data row of the section (0 if not applicable)"},
        },
        "required": ["column_index", "column_letter", "source_scaling", "skip_rows", "period_matched", "section_start_row", "section_end_row"],
    },
}


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
        col_prompt_vars: Dict[str, Any] = {
            "reporting_period": reporting_period,
            "header_rows": header_text,
            "statement_type": normalized if shared_tab else "",
        }

        col_prompt_vars["retry_hint"] = ""  # empty on first attempt
        col_info = self.claude.call_claude_with_tool(
            "layer1_column_identifier",
            col_prompt_vars,
            model,
            tool_def=_COLUMN_IDENTIFIER_TOOL,
            max_tokens=4096,
        )

        def _unpack_col_info(info: Dict[str, Any], st: bool) -> tuple:
            col_idx = int(info.get("column_index", 1))
            scaling = str(info.get("source_scaling", "actual_dollars"))
            s_skip = int(info.get("skip_rows", 0))
            col_id = str(info.get("period_matched", info.get("column_letter", "")))
            s_start = int(info.get("section_start_row", 0)) if st else 0
            s_end = int(info.get("section_end_row", 0)) if st else 0
            return col_idx, scaling, s_skip, col_id, s_start, s_end

        column_index, source_scaling, skip_rows, column_identified, section_start_row, section_end_row = (
            _unpack_col_info(col_info, shared_tab)
        )

        # ── Step B validation: verify the identified column has numeric data ──
        _verify_start = section_start_row if section_start_row > 0 else (skip_rows + 1)
        _verify_end = section_end_row if section_end_row > 0 else None
        numeric_count = count_numeric_values_in_column(
            filepath, sheet_name, column_index,
            start_row=_verify_start, end_row=_verify_end,
        )
        if numeric_count < 3:
            logger.warning(
                "[Layer1] %s: col %d ('%s') has only %d numeric rows — retrying Step B",
                normalized, column_index, col_info.get("column_letter", "?"), numeric_count,
            )
            col_prompt_vars["retry_hint"] = (
                f"\n> **RETRY NOTICE:** A previous attempt selected column "
                f"{column_index} (letter '{col_info.get('column_letter', '?')}') "
                f"but that column contained only {numeric_count} numeric data rows — "
                f"it is almost certainly wrong. Re-examine the headers very carefully "
                f"and select a different column that contains actual financial figures "
                f"for the period '{reporting_period}'."
            )
            col_info = self.claude.call_claude_with_tool(
                "layer1_column_identifier",
                col_prompt_vars,
                model,
                tool_def=_COLUMN_IDENTIFIER_TOOL,
                max_tokens=4096,
            )
            column_index, source_scaling, skip_rows, column_identified, section_start_row, section_end_row = (
                _unpack_col_info(col_info, shared_tab)
            )
            logger.info(
                "[Layer1] %s: retry selected col=%d scaling=%s",
                normalized, column_index, source_scaling,
            )

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
        logger.info("[Layer1] %s: Step C extracted %d rows", normalized, len(rows))

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
            "extractionDebug": {
                "columnIndex": column_index,
                "columnLetter": col_info.get("column_letter"),
                "periodMatched": col_info.get("period_matched"),
                "skipRows": skip_rows,
                "sectionStartRow": section_start_row,
                "sectionEndRow": section_end_row,
                "stepCRowCount": len(rows),
                "stepDRowCount": len(structured.get("rows", [])),
                "retried": bool(col_prompt_vars.get("retry_hint")),
            },
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
