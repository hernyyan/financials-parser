"""
Layer 1 extraction orchestration service.
Implemented as a Layer1Service class with a global singleton.
"""
import os
from typing import Any, Dict, Optional

from app.services.claude_service import ClaudeService, get_claude_service

PROMPT_MAP = {
    "income_statement": "layer1_income_statement",
    "balance_sheet": "layer1_balance_sheet",
}


class Layer1Service:
    """Orchestrates Layer 1 extraction for a single sheet."""

    def __init__(self, claude: ClaudeService) -> None:
        self.claude = claude

    def run_extraction(
        self,
        sheet_type: str,
        csv_content: str,
        reporting_period: str,
    ) -> Dict[str, Any]:
        """
        Run Layer 1 extraction on a single sheet.

        Args:
            sheet_type: 'income_statement' or 'balance_sheet'
            csv_content: Raw CSV string of the sheet (from openpyxl conversion)
            reporting_period: e.g. 'March 2024'

        Returns:
            Dict with keys: lineItems, sourceScaling, columnIdentified

        Raises:
            FileNotFoundError: If the prompt file is missing.
            ValueError: If the Claude response cannot be parsed.
            anthropic.APIError: On API failures.
        """
        model = os.getenv("LAYER1_MODEL", "claude-sonnet-4-6")

        normalized = sheet_type.lower().replace(" ", "_")
        prompt_key = PROMPT_MAP.get(normalized)

        if prompt_key is None:
            raise ValueError(
                f"Unknown sheet_type '{sheet_type}'. "
                "Expected 'income_statement' or 'balance_sheet'."
            )

        variables = {
            "reporting_period": reporting_period,
            "csv_content": csv_content,
        }

        response_text = self.claude.call_claude(prompt_key, variables, model)
        raw = self.claude.parse_json_response(response_text)
        return self._parse(raw)

    def _parse(self, raw: Any) -> Dict[str, Any]:
        """
        Normalise the raw Layer 1 JSON from Claude into the API response shape.

        Expected Claude output:
        {
          "line_items": { "Label": value, ... },
          "source_scaling": "actual_dollars",
          "column_identified": "03/31/2024"
        }
        """
        if not isinstance(raw, dict):
            raise ValueError(
                f"Layer 1: expected a JSON object, got {type(raw).__name__}."
            )

        raw_items = raw.get("line_items", {})
        if not isinstance(raw_items, dict):
            raise ValueError("Layer 1: 'line_items' must be a JSON object.")

        clean_items: Dict[str, float] = {}
        for label, value in raw_items.items():
            try:
                clean_items[str(label)] = float(value)
            except (TypeError, ValueError):
                continue  # Skip non-numeric values

        return {
            "lineItems": clean_items,
            "sourceScaling": str(raw.get("source_scaling", "unknown")),
            "columnIdentified": str(raw.get("column_identified", "unknown")),
        }


# ─── Global singleton ─────────────────────────────────────────────────────────

_service: Optional[Layer1Service] = None


def get_layer1_service() -> Layer1Service:
    """Return the app-wide Layer1Service singleton."""
    global _service
    if _service is None:
        _service = Layer1Service(claude=get_claude_service())
    return _service
