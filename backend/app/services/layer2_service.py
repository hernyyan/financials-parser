"""
Layer 2 classification service — formula-based architecture.

Each L2 field maps to a formula: an ordered list of {operator, row, label}
entries referencing L1 source rows by row number. The formula value is
computed by looking up each row's value in the L1 structured tree and
applying the arithmetic.

Execution priority:
  1. If saved formulas exist for this company -> deterministic execution (no AI).
  2. If no saved formulas -> AI best-effort single-row mapping (forced tool use).

Python L2-to-L2 recalculation runs as a CHECK only -- never overwrites formula values.
"""
import json
import os
from typing import Any, Dict, List, Optional

from sqlalchemy import text as sa_text

from app.services.claude_service import ClaudeService, get_claude_service
from app.services.recalculate_service import (
    recalculate_income_statement,
    recalculate_balance_sheet,
    recalculate_cash_flow_statement,
)

TOLERANCE = 1.0

PROMPT_MAP = {
    "income_statement": "layer2_income_statement",
    "balance_sheet": "layer2_balance_sheet",
    "cash_flow_statement": "layer2_cash_flow_statement",
}

_RECALC_FN = {
    "income_statement": recalculate_income_statement,
    "balance_sheet": recalculate_balance_sheet,
    "cash_flow_statement": recalculate_cash_flow_statement,
}

_IS_FIELDS = [
    "Total Revenue", "COGS", "Gross Profit", "Total Operating Expenses",
    "EBITDA - Standard", "EBITDA Adjustments", "Adjusted EBITDA - Standard",
    "Depreciation & Amortization", "Interest Expense/(Income)",
    "Other Expense / (Income)", "Taxes", "Net Income (Loss)",
    "LTM - Adj EBITDA items", "Equity Cure",
    "Adjusted EBITDA - Including Cures", "Covenant EBITDA",
]

_BS_FIELDS = [
    "Cash & Cash Equivalents", "Accounts Receivable", "Inventory",
    "Prepaid Expenses", "Other Current Assets", "Total Current Assets",
    "Property, Plant & Equipment", "Accumulated Depreciation",
    "Goodwill & Intangibles", "Other non-current assets", "Total Non-Current Assets",
    "Total Assets", "Accounts Payable", "Accrued Liabilities", "Deferred Revenue",
    "Revolver - Balance Sheet", "Current Maturities", "Other Current Liabilities",
    "Total Current Liabilities", "Long Term Loans", "Long Term Leases",
    "Other Non-Current Liabilities", "Total Non-Current Liabilities",
    "Total Liabilities", "Paid in Capital", "Retained Earnings", "Other Equity",
    "Total Equity", "Total Liabilities and Equity", "Check",
]

_CFS_FIELDS = [
    "Operating Cash Flow (Working Capital)", "Operating Cash Flow (Non-Working Capital)",
    "Operating Cash Flow", "Investing Cash Flow", "Financing Cash Flow", "CAPEX",
]

_FIELDS_BY_TYPE = {
    "income_statement": _IS_FIELDS,
    "balance_sheet": _BS_FIELDS,
    "cash_flow_statement": _CFS_FIELDS,
}


def _make_mapping_tool(field_names: List[str]) -> Dict:
    """Build forced-tool-use tool for single-row L1->L2 mapping."""
    properties: Dict[str, Any] = {}
    for field in field_names:
        properties[field] = {
            "description": "Best-effort single L1 row match, or null if no confident match.",
            "oneOf": [
                {
                    "type": "object",
                    "properties": {
                        "row":   {"type": "integer", "description": "source_row number from L1"},
                        "label": {"type": "string",  "description": "verbatim label from L1"},
                    },
                    "required": ["row", "label"],
                },
                {"type": "null"},
            ],
        }
    return {
        "name": "map_l1_to_l2",
        "description": "Map each L2 template field to the single best-matching L1 source row.",
        "input_schema": {
            "type": "object",
            "properties": properties,
            "required": field_names,
        },
    }


def _build_row_value_map(structured_rows: List[Dict]) -> Dict[int, Optional[float]]:
    """Recursively walk L1 structured rows -> {source_row: value}."""
    result: Dict[int, Optional[float]] = {}

    def walk(rows: List[Dict]) -> None:
        for r in rows:
            row_idx = r.get("source_row") or r.get("row_index")
            if row_idx:
                result[int(row_idx)] = r.get("value")
            walk(r.get("children", []))

    walk(structured_rows)
    return result


def _l1_rows_to_display(structured_rows: List[Dict]) -> str:
    """Render L1 structured rows as a simple table for the AI prompt."""
    lines = ["row_index | label | value", "-" * 55]

    def walk(rows: List[Dict]) -> None:
        for r in rows:
            if r.get("isSectionBreak"):
                continue
            row_idx = r.get("source_row") or r.get("row_index") or ""
            label = r.get("label", "")
            value = r.get("value")
            val_str = f"{value:,.2f}" if isinstance(value, (int, float)) else "--"
            lines.append(f"{str(row_idx):<10} | {label:<40} | {val_str}")
            walk(r.get("children", []))

    walk(structured_rows)
    return "\n".join(lines)


def _execute_formulas(
    formulas: Dict[str, List[Dict]],
    row_value_map: Dict[int, Optional[float]],
) -> Dict[str, Optional[float]]:
    """Execute saved formulas against L1 row values."""
    results: Dict[str, Optional[float]] = {}
    for field, formula_rows in formulas.items():
        if not formula_rows:
            results[field] = None
            continue
        total: Optional[float] = None
        for fr in formula_rows:
            row_num = fr.get("row")
            op = fr.get("operator", "+")
            val = row_value_map.get(int(row_num)) if row_num else None
            if val is None:
                continue
            if total is None:
                total = val if op == "+" else -val
            else:
                total = total + val if op == "+" else total - val
        results[field] = round(total, 2) if total is not None else None
    return results


def _formulas_from_ai_mapping(ai_mapping: Dict[str, Any]) -> Dict[str, List[Dict]]:
    """Convert AI single-row mapping -> formula list per field."""
    formulas: Dict[str, List[Dict]] = {}
    for field, match in ai_mapping.items():
        if match and isinstance(match, dict) and match.get("row"):
            formulas[field] = [{"operator": "+", "row": int(match["row"]), "label": str(match.get("label", ""))}]
        else:
            formulas[field] = []
    return formulas


def _run_python_check(
    statement_type: str,
    formula_values: Dict[str, Optional[float]],
):
    """Run L2-to-L2 recalculation as a check. Returns (py_values, py_flagged_fields)."""
    recalc_fn = _RECALC_FN.get(statement_type)
    if not recalc_fn:
        return {}, []
    recalc = recalc_fn(values=dict(formula_values), ai_matched={}, overrides={})
    py_values = recalc["values"]
    py_flagged = []
    for field, py_val in py_values.items():
        formula_val = formula_values.get(field)
        if py_val is None or formula_val is None:
            continue
        if abs(py_val - formula_val) > TOLERANCE:
            py_flagged.append(field)
    return py_values, py_flagged


class Layer2Service:
    def __init__(self, claude: ClaudeService) -> None:
        self.claude = claude

    def run_classification(
        self,
        statement_type: str,
        layer1_structured: Dict,
        company_id: Optional[int] = None,
        db: Optional[Any] = None,
    ) -> Dict[str, Any]:
        model = os.getenv("LAYER2_MODEL", "claude-opus-4-6")
        normalized = statement_type.lower().replace(" ", "_")
        if normalized not in PROMPT_MAP:
            raise ValueError(f"Unknown statement_type '{statement_type}'.")

        structured_rows = layer1_structured.get("rows", [])
        row_value_map = _build_row_value_map(structured_rows)
        source_labels: Dict[str, List[str]] = {}

        saved_formulas = self._load_saved_formulas(company_id, normalized, db)

        if saved_formulas:
            formulas = saved_formulas
        else:
            fields = _FIELDS_BY_TYPE.get(normalized, [])
            tool = _make_mapping_tool(fields)
            rows_display = _l1_rows_to_display(structured_rows)
            ai_mapping = self.claude.call_claude_with_tool(
                PROMPT_MAP[normalized],
                {"statement_type": normalized, "layer1_rows": rows_display},
                model,
                tool_def=tool,
                max_tokens=4096,
            )
            formulas = _formulas_from_ai_mapping(ai_mapping)
            for field, formula_rows in formulas.items():
                if formula_rows:
                    source_labels[field] = [fr["label"] for fr in formula_rows]

        formula_values = _execute_formulas(formulas, row_value_map)
        python_check_values, python_flagged = _run_python_check(normalized, formula_values)

        return {
            "statementType": normalized,
            "formulaValues": formula_values,
            "pythonCheckValues": python_check_values,
            "pythonFlaggedFields": python_flagged,
            "formulas": formulas,
            "flaggedFields": [],
            "sourceLabels": source_labels,
        }

    def _load_saved_formulas(
        self,
        company_id: Optional[int],
        statement_type: str,
        db: Optional[Any],
    ) -> Optional[Dict[str, List[Dict]]]:
        if not company_id or not db:
            return None
        try:
            row = db.execute(
                sa_text("SELECT formulas FROM layer2_formula_configs WHERE company_id = :id"),
                {"id": company_id},
            ).fetchone()
            if not row or not row[0]:
                return None
            all_formulas = row[0] if isinstance(row[0], dict) else json.loads(row[0])
            return all_formulas.get(statement_type) or None
        except Exception:
            return None


_service: Optional[Layer2Service] = None


def get_layer2_service() -> Layer2Service:
    global _service
    if _service is None:
        _service = Layer2Service(claude=get_claude_service())
    return _service
