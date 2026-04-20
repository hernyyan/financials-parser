"""
Layer 2 classification service.
Implemented as a Layer2Service class with a global singleton.

The Layer 2 Claude prompt returns a single JSON object with:
  - Statement data (flat or nested under section keys like REVENUE, ASSETS, etc.)
  - REASONING key: dict of field_name → reasoning string
  - VALIDATION key: dict of check_name → {status, details}
  - Fields may carry __FLAGGED suffix to signal low-confidence

This service splits that response into its components, flattens nested sections,
and maps validation checks to the fields they reference.
"""
import json
import os
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session
from sqlalchemy import text as sa_text
from app.config import COMPANY_CONTEXT_DIR
from app.services.claude_service import ClaudeService, get_claude_service
from app.services.recalculate_service import (
    recalculate_income_statement,
    recalculate_balance_sheet,
    recalculate_cash_flow_statement,
)

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


class Layer2Service:
    def __init__(self, claude: ClaudeService) -> None:
        self.claude = claude

    def run_classification(
        self,
        statement_type: str,
        layer1_data: Dict[str, float],
        company_id: Optional[int] = None,
        use_company_context: bool = False,
        db: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """
        Run Layer 2 classification for a single statement type.

        Args:
            statement_type: 'income_statement' or 'balance_sheet'
            layer1_data: The lineItems dict from Layer 1 (field_name → float)
            company_id: Optional company ID for context injection
            use_company_context: Whether to inject company-specific rules
            db: Database session (required if use_company_context is True)

        Returns:
            Dict with keys: statementType, values, reasoning, validation,
                            flaggedFields, fieldValidations
        """
        model = os.getenv("LAYER2_MODEL", "claude-opus-4-6")

        normalized = statement_type.lower().replace(" ", "_")
        prompt_key = PROMPT_MAP.get(normalized)

        if prompt_key is None:
            raise ValueError(
                f"Unknown statement_type '{statement_type}'. "
                "Expected 'income_statement', 'balance_sheet', or 'cash_flow_statement'."
            )

        # Load company context if toggled on
        company_context = ""
        if use_company_context and company_id and db:
            company_context = self._load_company_context(company_id, db)

        variables = {
            "layer1_output": json.dumps(layer1_data, indent=2),
            "company_context": company_context,
        }

        response_text = self.claude.call_claude(prompt_key, variables, model, max_tokens=32768)
        parsed = self.claude.parse_json_response(response_text)
        split = self._split_response(parsed, normalized)

        # Extract source-reported values for calculated fields from reasoning text
        _CALC_FIELDS = {
            'Gross Profit', 'EBITDA - Standard', 'Adjusted EBITDA - Standard',
            'Net Income (Loss)', 'Adjusted EBITDA - Including Cures',
            'Total Current Assets', 'Total Non-Current Assets', 'Total Assets',
            'Total Current Liabilities', 'Total Non-Current Liabilities',
            'Total Liabilities', 'Total Equity', 'Total Liabilities and Equity',
            'Operating Cash Flow',
        }
        import re as _re
        reasoning = split.get('reasoning', {})
        for _field in _CALC_FIELDS:
            if _field in reasoning:
                _rt = str(reasoning[_field])
                if 'source_reported_value' in _rt:
                    _m = _re.search(r"""source_reported_value[\"']?\s*:\s*([+-]?[\d,]+(?:\.[\d]+)?)""", _rt, _re.IGNORECASE)
                    if _m:
                        try:
                            split['values'][_field + '_source_reported'] = float(_m.group(1).replace(',', ''))
                        except ValueError:
                            pass

        # Run Python recalculation — overwrite calculated fields, preserve ai_matched
        recalc_fn = _RECALC_FN.get(normalized)
        if recalc_fn:
            ai_matched = dict(split['values'])  # raw AI values before recalc
            # For calculated fields: use source-reported value if extracted, else None
            for _field in _CALC_FIELDS:
                _temp_key = _field + '_source_reported'
                if _temp_key in ai_matched:
                    ai_matched[_field] = ai_matched.pop(_temp_key)
                else:
                    ai_matched[_field] = None
                split['values'].pop(_field + '_source_reported', None)
            recalc = recalc_fn(
                values=split['values'],
                ai_matched=ai_matched,
                overrides={},
            )
            split['values'] = recalc['values']
            split['calculationMeta'] = recalc['calculationMeta']
            split['aiMatchedValues'] = ai_matched
            split['flaggedFields'] = list(set(
                split.get('flaggedFields', []) + recalc['flaggedFields']
            ))
        else:
            split['calculationMeta'] = {}
            split['aiMatchedValues'] = {}

        return split

    def _load_company_context(self, company_id: int, db: Any) -> str:
        """
        Load the company's markdown context file and return its content,
        but only if it contains actual rules (bullet points).
        Returns empty string if no rules exist.
        """
        try:
            row = db.execute(
                sa_text("SELECT markdown_filename FROM companies WHERE id = :id"),
                {"id": company_id},
            ).fetchone()

            if not row or not row[0]:
                return ""

            md_path = COMPANY_CONTEXT_DIR / row[0]
            if not md_path.exists():
                return ""

            content = md_path.read_text(encoding="utf-8")

            # Check if file has actual rules (bullet points), not just the header
            lines = content.split("\n")
            has_rules = any(l.strip().startswith("- ") for l in lines)

            if not has_rules:
                return ""

            return content
        except Exception:
            return ""

    def _split_response(self, parsed: Any, statement_type: str) -> Dict[str, Any]:
        """
        Split the raw Layer 2 JSON into separate components.

        Handles both flat and nested response structures:
          - Flat: {"Net Revenue": 3621577.27, "COGS": 432658.88, ...}
          - Nested: {"REVENUE": {"Net Revenue": 3621577.27}, "COGS_SECTION": {"COGS": ...}}
        """
        if not isinstance(parsed, dict):
            raise ValueError(
                f"Layer 2: expected a JSON object, got {type(parsed).__name__}."
            )

        reasoning: Dict[str, str] = {}
        validation_raw: Dict[str, Any] = {}
        source_labels: Dict[str, List[str]] = {}
        values: Dict[str, Optional[float]] = {}
        flagged_fields: List[str] = []

        for key, val in parsed.items():
            if key == "REASONING":
                if isinstance(val, dict):
                    reasoning = {str(k): str(v) for k, v in val.items()}
            elif key == "SOURCE_LABELS":
                if isinstance(val, dict):
                    source_labels = {
                        str(k): [str(lbl) for lbl in v] if isinstance(v, list) else [str(v)]
                        for k, v in val.items()
                    }
            elif key == "VALIDATION":
                if isinstance(val, dict):
                    validation_raw = val
            elif isinstance(val, dict):
                # Nested section — flatten into values
                for field_name, field_value in val.items():
                    clean_name = str(field_name).replace("__FLAGGED", "").strip()
                    try:
                        values[clean_name] = float(field_value) if field_value is not None else None
                    except (TypeError, ValueError):
                        values[clean_name] = None
                    if "__FLAGGED" in str(field_name):
                        flagged_fields.append(clean_name)
            else:
                # Flat top-level field
                clean_name = str(key).replace("__FLAGGED", "").strip()
                try:
                    values[clean_name] = float(val) if val is not None else None
                except (TypeError, ValueError):
                    values[clean_name] = None
                if "__FLAGGED" in key:
                    flagged_fields.append(clean_name)

        # Parse validation checks into structured format
        structured_validation: Dict[str, Any] = {}
        for check_name, check_data in validation_raw.items():
            check_name_str = str(check_name)
            if isinstance(check_data, dict):
                structured_validation[check_name_str] = {
                    "checkName": check_name_str,
                    "status": str(check_data.get("status", "UNKNOWN")),
                    "details": str(check_data.get("details", "")),
                }
            elif isinstance(check_data, str):
                status = "PASS" if "PASS" in check_data.upper() else "FAIL"
                structured_validation[check_name_str] = {
                    "checkName": check_name_str,
                    "status": status,
                    "details": check_data,
                }

        field_validations = self._map_validations_to_fields(structured_validation, values)

        return {
            "statementType": statement_type,
            "values": values,
            "reasoning": reasoning,
            "validation": structured_validation,
            "flaggedFields": flagged_fields,
            "fieldValidations": field_validations,
            "sourceLabels": source_labels,
        }

    def _map_validations_to_fields(
        self,
        validation: Dict[str, Any],
        values: Dict[str, Any],
    ) -> Dict[str, List[str]]:
        """
        For each template field, find which validation checks reference it.
        Searches both the check name and details text for the field name.
        Returns: {field_name: [check_name, ...]}
        """
        field_validations: Dict[str, List[str]] = {}
        for check_name, check_result in validation.items():
            details = (
                check_result.get("details", "")
                if isinstance(check_result, dict)
                else str(check_result)
            )
            combined_text = (check_name + " " + details).lower()
            for field_name in values.keys():
                if field_name.lower() in combined_text:
                    if field_name not in field_validations:
                        field_validations[field_name] = []
                    field_validations[field_name].append(check_name)
        return field_validations


# ─── Global singleton ─────────────────────────────────────────────────────────

_service: Optional[Layer2Service] = None


def get_layer2_service() -> Layer2Service:
    """Return the app-wide Layer2Service singleton."""
    global _service
    if _service is None:
        _service = Layer2Service(claude=get_claude_service())
    return _service
