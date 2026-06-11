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
    col_index_to_letter,
    count_numeric_values_in_column,
    extract_header_rows,
    extract_rows_with_metadata,
    extract_all_rows_for_display,
    rows_to_csv_with_metadata,
)

logger = logging.getLogger(__name__)

_VALID_TYPES = {"income_statement", "balance_sheet", "cash_flow_statement"}

_ROW_SCHEMA = {
    "type": "object",
    "properties": {
        "id":               {"type": "integer"},
        "type":             {"type": "string", "enum": ["sum", "individual"]},
        "label":            {"type": "string"},
        "value":            {"type": ["number", "null"]},
        "bold":             {"type": "boolean"},
        "italic":           {"type": "boolean"},
        "indent":           {"type": "integer"},
        "validated":        {"type": "boolean"},
        "validation_note":  {"type": "string"},
        "computed_as":      {"type": "string"},
        "children":         {"type": "array", "items": {"$ref": "#/$defs/row"}},
    },
    "required": ["id", "type", "label", "children"],
}

_EXTRACT_HIERARCHY_TOOL = {
    "name": "extract_hierarchy",
    "description": "Output the nested row hierarchy extracted from the financial statement CSV.",
    "input_schema": {
        "type": "object",
        "properties": {
            "rows": {
                "type": "array",
                "description": "Top-level rows of the hierarchy in CSV row_index order.",
                "items": {"$ref": "#/$defs/row"},
            },
            "waterfall": {
                "type": "array",
                "description": "Waterfall entries (income statement only). Omit for balance sheet / CFS.",
                "items": {
                    "type": "object",
                    "properties": {
                        "row_id":   {"type": "integer"},
                        "label":    {"type": "string"},
                        "operator": {"type": "string", "enum": ["+", "-", "="]},
                    },
                    "required": ["row_id", "label", "operator"],
                },
            },
            "validation_flags": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
        "required": ["rows"],
        "$defs": {"row": _ROW_SCHEMA},
    },
}

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


MAX_ATTEMPTS = 2


def _unpack_col_info(info: Dict[str, Any], shared_tab: bool) -> tuple:
    col_idx = int(info.get("column_index", 1))
    scaling = str(info.get("source_scaling", "actual_dollars"))
    s_skip = int(info.get("skip_rows", 0))
    col_id = str(info.get("period_matched", info.get("column_letter", "")))
    s_start = int(info.get("section_start_row", 0)) if shared_tab else 0
    s_end = int(info.get("section_end_row", 0)) if shared_tab else 0
    return col_idx, scaling, s_skip, col_id, s_start, s_end


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
        label_col_override: Optional[int] = None,
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

        # ── Steps B→D: column identification, extraction, hierarchy ─────────────
        # Retried up to MAX_ATTEMPTS times if lineItems comes back empty.

        col_prompt_vars: Dict[str, Any] = {
            "reporting_period": reporting_period,
            "header_rows": header_text,
            "statement_type": normalized if shared_tab else "",
            "retry_hint": "",
        }

        col_info: Dict[str, Any] = {}
        column_index = 1
        source_scaling = "actual_dollars"
        skip_rows = 0
        column_identified = ""
        section_start_row = 0
        section_end_row = 0
        rows: list = []
        structured: Dict[str, Any] = {}
        line_items: Dict[str, float] = {}

        for attempt in range(MAX_ATTEMPTS):
            # Step B: AI column identifier
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

            # Step B validation: verify column has numeric data; retry once inline
            _verify_start = section_start_row if section_start_row > 0 else max(skip_rows + 1, 1)
            _verify_end = section_end_row if section_end_row > 0 else None
            numeric_count = count_numeric_values_in_column(
                filepath, sheet_name, column_index,
                start_row=_verify_start, end_row=_verify_end,
            )
            if numeric_count < 3:
                logger.warning(
                    "[Layer1] %s attempt %d: col %d ('%s') has only %d numeric rows — inner retry",
                    normalized, attempt + 1, column_index, col_info.get("column_letter", "?"), numeric_count,
                )
                col_prompt_vars["retry_hint"] = (
                    f"\n> **COLUMN CHECK:** Column {column_index} "
                    f"('{col_info.get('column_letter', '?')}') contains only "
                    f"{numeric_count} numeric values — it is wrong. "
                    f"Select the column that actually contains financial data for '{reporting_period}'."
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
                "[Layer1] %s attempt %d/%d: col=%d scaling=%s section=%s-%s",
                normalized, attempt + 1, MAX_ATTEMPTS, column_index, source_scaling,
                section_start_row or "auto", section_end_row or "end",
            )

            # Step C: full row extraction
            rows = extract_rows_with_metadata(
                filepath, sheet_name,
                column_index=column_index,
                source_scaling=source_scaling,
                skip_rows=skip_rows,
                section_start_row=section_start_row,
                section_end_row=section_end_row,
                label_col_override=label_col_override,
            )
            logger.info("[Layer1] %s attempt %d: Step C → %d rows", normalized, attempt + 1, len(rows))

            if not rows and attempt < MAX_ATTEMPTS - 1:
                col_prompt_vars["retry_hint"] = (
                    f"\n> **RETRY {attempt + 2}/{MAX_ATTEMPTS}:** Column {column_index} "
                    f"('{col_info.get('column_letter', '?')}') produced 0 data rows after full extraction. "
                    f"It is the wrong column. Choose a different column with actual financial data "
                    f"for the period '{reporting_period}'."
                )
                logger.warning("[Layer1] %s: 0 rows on attempt %d — retrying", normalized, attempt + 1)
                continue  # retry from Step B

            rows_csv = rows_to_csv_with_metadata(rows)

            # Step D: AI hierarchy classification (forced tool use — no JSON parsing needed)
            structured = self.claude.call_claude_with_tool(
                "layer1_structured_extractor",
                {"statement_type": normalized, "reporting_period": reporting_period, "rows_csv": rows_csv},
                model,
                _EXTRACT_HIERARCHY_TOOL,
                max_tokens=16384,
            )
            if "rows" in structured:
                structured["rows"] = _strip_margins(structured["rows"])
                _stamp_source_rows(structured["rows"], rows)

            line_items = _flatten_structured(structured.get("rows", []))
            logger.info("[Layer1] %s attempt %d: %d lineItems", normalized, attempt + 1, len(line_items))

            if line_items or attempt == MAX_ATTEMPTS - 1:
                break

            col_prompt_vars["retry_hint"] = (
                f"\n> **RETRY {attempt + 2}/{MAX_ATTEMPTS}:** Column {column_index} "
                f"('{col_info.get('column_letter', '?')}') extracted {len(rows)} rows but "
                f"hierarchy classification produced 0 line items. "
                f"Either the column or the row interpretation is wrong."
            )
            logger.warning("[Layer1] %s: 0 lineItems on attempt %d — retrying", normalized, attempt + 1)

        # Full-fidelity display rows for template editor left panel.
        # Pass the label_col from Step C rows to skip the second _find_label_column scan.
        _step_c_label_col = rows[0]["label_col"] if rows else None
        display_rows, label_col_letter = extract_all_rows_for_display(
            filepath, sheet_name,
            column_index=column_index,
            source_scaling=source_scaling,
            skip_rows=skip_rows,
            section_start_row=section_start_row,
            section_end_row=section_end_row,
            label_col_override=label_col_override,
            precomputed_label_col=_step_c_label_col,
        )

        return {
            "lineItems": line_items,
            "structured": structured,
            "sourceRows": display_rows,
            "labelColLetter": label_col_letter,
            "valueColLetter": col_info.get("column_letter", ""),
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
                "attempts": attempt + 1,
            },
        }

    # ── Public: template helpers ─────────────────────────────────────────────

    def extract_source_rows(
        self,
        filepath: str,
        sheet_name: str,
        sheet_type: str,
        reporting_period: str,
        shared_tab: bool = False,
        label_col_override: Optional[int] = None,
        explicit_value_col: Optional[int] = None,
    ):
        """
        Steps A+B+C only. Returns (rows, column_identified, source_scaling) where
        rows is a list of {row_index, label, value} dicts. Used by the template
        editor to populate the source panel without running full AI classification.

        Uses the same column validation + retry logic as run_extraction to avoid
        AI misidentifying the wrong column.
        """
        model = os.getenv("LAYER1_MODEL", "claude-sonnet-4-6")
        normalized = sheet_type.lower().replace(" ", "_")

        header_text = extract_header_rows(filepath, sheet_name, n_rows=150)
        col_prompt_vars: Dict[str, Any] = {
            "reporting_period": reporting_period,
            "header_rows": header_text,
            "statement_type": normalized if shared_tab else "",
            "retry_hint": "",
        }

        col_info: Dict[str, Any] = {}
        column_index = 1
        source_scaling = "actual_dollars"
        skip_rows = 0
        column_identified = ""
        section_start_row = 0
        section_end_row = 0
        rows: list = []

        # Fast path: explicit value column provided — skip AI column identification
        if explicit_value_col:
            column_index = explicit_value_col
            column_identified = col_index_to_letter(explicit_value_col)
            col_info = {"column_letter": column_identified}
            rows = extract_rows_with_metadata(
                filepath, sheet_name,
                column_index=column_index,
                source_scaling=source_scaling,
                skip_rows=0,
                section_start_row=0,
                section_end_row=0,
                label_col_override=label_col_override,
            )
            _step_c_label_col_fast = rows[0]["label_col"] if rows else None
            display_rows, label_col_letter = extract_all_rows_for_display(
                filepath, sheet_name,
                column_index=column_index,
                source_scaling=source_scaling,
                skip_rows=0,
                section_start_row=0,
                section_end_row=0,
                label_col_override=label_col_override,
                precomputed_label_col=_step_c_label_col_fast,
            )
            value_col_letter = col_index_to_letter(column_index)
            return display_rows, column_identified, source_scaling, label_col_letter, value_col_letter

        for attempt in range(MAX_ATTEMPTS):
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

            # Validate column has numeric data; retry inline if not
            _verify_start = section_start_row if section_start_row > 0 else max(skip_rows + 1, 1)
            _verify_end = section_end_row if section_end_row > 0 else None
            numeric_count = count_numeric_values_in_column(
                filepath, sheet_name, column_index,
                start_row=_verify_start, end_row=_verify_end,
            )
            if numeric_count < 3:
                logger.warning(
                    "[source-rows] attempt %d: col %d has only %d numeric rows — retrying",
                    attempt + 1, column_index, numeric_count,
                )
                col_prompt_vars["retry_hint"] = (
                    f"\n> **COLUMN CHECK:** Column {column_index} "
                    f"('{col_info.get('column_letter', '?')}') contains only "
                    f"{numeric_count} numeric values — it is wrong. "
                    f"Select the column that actually contains financial data for '{reporting_period}'."
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

            rows = extract_rows_with_metadata(
                filepath, sheet_name,
                column_index=column_index,
                source_scaling=source_scaling,
                skip_rows=skip_rows,
                section_start_row=section_start_row,
                section_end_row=section_end_row,
                label_col_override=label_col_override,
            )
            logger.info("[source-rows] attempt %d: col=%d → %d rows", attempt + 1, column_index, len(rows))

            if rows or attempt == MAX_ATTEMPTS - 1:
                break

            col_prompt_vars["retry_hint"] = (
                f"\n> **RETRY {attempt + 2}/{MAX_ATTEMPTS}:** Column {column_index} produced 0 rows. "
                f"Choose a different column with actual financial data for '{reporting_period}'."
            )

        _src_label_col = rows[0]["label_col"] if rows else None
        display_rows, label_col_letter = extract_all_rows_for_display(
            filepath, sheet_name,
            column_index=column_index,
            source_scaling=source_scaling,
            skip_rows=skip_rows,
            section_start_row=section_start_row,
            section_end_row=section_end_row,
            label_col_override=label_col_override,
            precomputed_label_col=_src_label_col,
        )
        value_col_letter = col_index_to_letter(column_index)
        return display_rows, column_identified, source_scaling, label_col_letter, value_col_letter

    def run_deterministic_extraction(
        self,
        filepath: str,
        sheet_name: str,
        reporting_period: str,
        template: Dict[str, Any],
        shared_tab: bool = False,
    ) -> Dict[str, Any]:
        """
        Deterministic IS extraction using a schema_version 2 template.

        Runs Steps A+B (AI column identification) and Step C (Python row extraction).
        Skips Step D (AI hierarchy classification) — uses the stored template rows
        directly and maps values by source_row (row_index from Step C).

        Returns the same shape as run_extraction().
        """
        model = os.getenv("LAYER1_MODEL", "claude-sonnet-4-6")

        # Step A + B: identify column (still needs AI for period matching)
        header_text = extract_header_rows(filepath, sheet_name, n_rows=150)
        normalized = template.get("meta", {}).get("statement_type", "income_statement")

        col_prompt_vars: Dict[str, Any] = {
            "reporting_period": reporting_period,
            "header_rows": header_text,
            "statement_type": normalized if shared_tab else "",
            "retry_hint": "",
        }
        col_info = self.claude.call_claude_with_tool(
            "layer1_column_identifier",
            col_prompt_vars,
            model,
            tool_def=_COLUMN_IDENTIFIER_TOOL,
            max_tokens=4096,
        )
        column_index = int(col_info.get("column_index", 1))
        source_scaling = str(col_info.get("source_scaling", "actual_dollars"))
        skip_rows = int(col_info.get("skip_rows", 0))
        column_identified = str(col_info.get("period_matched", col_info.get("column_letter", "")))
        section_start_row = int(col_info.get("section_start_row", 0)) if shared_tab else 0
        section_end_row = int(col_info.get("section_end_row", 0)) if shared_tab else 0

        # Step C: full row extraction
        rows = extract_rows_with_metadata(
            filepath, sheet_name,
            column_index=column_index,
            source_scaling=source_scaling,
            skip_rows=skip_rows,
            section_start_row=section_start_row,
            section_end_row=section_end_row,
        )

        # Map template rows to Step C values by source_row
        step_c_by_row_index = {r["row_index"]: r for r in rows}
        template_rows = template.get("rows", [])

        def _build_structured_rows(tmpl_rows: List[Dict]) -> List[Dict]:
            result = []
            for tr in tmpl_rows:
                source_row = tr.get("source_row")
                step_c = step_c_by_row_index.get(source_row) if source_row else None
                value = step_c["value"] if step_c else None
                row_out: Dict[str, Any] = {
                    "id": tr.get("id", 0),
                    "label": tr["label"],
                    "operator": tr.get("operator"),
                    "source_row": source_row,
                    "value": value,
                    "hidden": tr.get("hidden", False),
                    "children": _build_structured_rows(tr.get("children", [])),
                }
                result.append(row_out)
            return result

        structured_rows = _build_structured_rows(template_rows)

        # Build lineItems flat dict for Layer 2 compatibility.
        # operator=None means "excluded" — skip the row and its entire subtree.
        # operator='+'/'-'/'=' means the row participates in the waterfall.
        line_items: Dict[str, float] = {}
        def _collect_line_items(rows: List[Dict]) -> None:
            for r in rows:
                if r.get("operator") is None:
                    # Excluded/informational row — skip this row and all its children
                    continue
                if r.get("value") is not None:
                    try:
                        line_items[r["label"]] = float(r["value"])
                    except (TypeError, ValueError):
                        pass
                _collect_line_items(r.get("children", []))

        _collect_line_items(structured_rows)

        structured = {
            "rows": structured_rows,
            "meta": template.get("meta", {}),
            "deterministic": True,
        }

        logger.info(
            "[Layer1] deterministic extraction: col=%d scaling=%s %d template rows → %d lineItems",
            column_index, source_scaling, len(template_rows), len(line_items),
        )

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
                "deterministic": True,
            },
        }

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


def _stamp_source_rows(structured_rows: List[Dict], step_c_rows: List[Dict]) -> None:
    """
    Walk structured rows in-place and stamp source_row by sequentially matching
    each row's label against the Step C extraction rows.

    Uses sequential (Nth-occurrence) matching so duplicate labels (e.g. a segment
    named "USBid" under both Orders and Revenue) each get the correct distinct
    row_index rather than all resolving to the same row.
    """
    from collections import defaultdict

    # Build label → ordered list of row_index values
    label_to_indices: Dict[str, List[int]] = defaultdict(list)
    for r in step_c_rows:
        norm = re.sub(r"[^a-z0-9]", "", r["label"].lower())
        label_to_indices[norm].append(r["row_index"])

    used_counts: Dict[str, int] = {}

    def walk(rows: List[Dict]) -> None:
        for r in rows:
            norm = re.sub(r"[^a-z0-9]", "", r.get("label", "").lower())
            indices = label_to_indices.get(norm, [])
            if indices:
                count = used_counts.get(norm, 0)
                if count < len(indices):
                    r["source_row"] = indices[count]
                used_counts[norm] = count + 1
            walk(r.get("children", []))

    walk(structured_rows)


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
