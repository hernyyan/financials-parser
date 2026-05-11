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
import re
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session
from sqlalchemy import text as sa_text
from app.services.claude_service import ClaudeService, get_claude_service
from app.services.layer2_response_parser import parse_layer2_response
from app.services.recalculate_service import (
    recalculate_income_statement,
    recalculate_balance_sheet,
    recalculate_cash_flow_statement,
    CALCULATED_FIELDS,
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
        parsed_response = parse_layer2_response(parsed)
        split = {
            "statementType": normalized,
            "values": parsed_response.values,
            "reasoning": parsed_response.reasoning,
            "validation": parsed_response.validation_raw,
            "flaggedFields": parsed_response.flagged_fields,
            "fieldValidations": parsed_response.field_validations,
            "sourceLabels": parsed_response.source_labels,
        }

        # Extract source-reported values for calculated fields from reasoning text
        reasoning = split.get('reasoning', {})
        for _field in CALCULATED_FIELDS:
            if _field in reasoning:
                _rt = str(reasoning[_field])
                if 'source_reported_value' in _rt:
                    _m = re.search(r"""source_reported_value[\"']?\s*:\s*([+-]?[\d,]+(?:\.[\d]+)?)""", _rt, re.IGNORECASE)
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
            for _field in CALCULATED_FIELDS:
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
        Load the company's context from DB and return its content,
        but only if it contains actual rules (bullet points).
        Returns empty string if no rules exist.
        """
        try:
            row = db.execute(
                sa_text("SELECT context FROM companies WHERE id = :id"),
                {"id": company_id},
            ).fetchone()

            if not row or not row[0]:
                return ""

            content = row[0]

            # Only return if file has actual rules (bullet points), not just the header
            lines = content.split("\n")
            has_rules = any(l.strip().startswith("- ") for l in lines)

            return content if has_rules else ""
        except Exception:
            return ""



# ─── Global singleton ─────────────────────────────────────────────────────────

_service: Optional[Layer2Service] = None


def get_layer2_service() -> Layer2Service:
    """Return the app-wide Layer2Service singleton."""
    global _service
    if _service is None:
        _service = Layer2Service(claude=get_claude_service())
    return _service
