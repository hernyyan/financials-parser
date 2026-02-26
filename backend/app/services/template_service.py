"""
Template service — loads and parses the firm's standardized output template.
Provides the canonical field ordering used to render template tables in the UI.
"""
import csv
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app.config import TEMPLATES_DIR

# Income Statement section groupings.
# The IS portion of loader_template.csv has no explicit sub-section headers,
# so we define them here based on the Layer 2 prompt structure.
IS_SECTION_MAP: List[Tuple[Optional[str], List[str]]] = [
    ("REVENUE", ["Gross Revenue", "Net Revenue", "Total Revenue"]),
    (
        "COST OF GOODS SOLD",
        [
            "COGS",
            "COGS - Depreciation & Amortization",
            "Gross Profit",
            "Gross Profit Margin %",
        ],
    ),
    (
        "OPERATING EXPENSES",
        [
            "Sales & Marketing Expenses",
            "Administrative Expenses",
            "Compensation & Benefits Expense",
            "Research & Development",
            "Rent Expense",
            "Management Fee Expense",
            "Other Operating Expenses",
            "Total Operating Expenses",
        ],
    ),
    (None, ["Net Operating Income"]),
    (
        "BELOW THE LINE",
        [
            "Depreciation & Amortization",
            "Loss/(Gain) on Assets, Debt, FX",
            "Non-Operating Expenses",
            "Non-Operating Expenses - Depreciation & Amortization",
            "Interest Expense/(Income)",
            "Other Income",
            "Other Expenses",
            "Total Expense/(Income)",
        ],
    ),
    (
        "PRE-TAX AND NET INCOME",
        ["Income (Loss) Before Taxes", "Taxes", "Net Income (Loss)"],
    ),
    (
        "EBITDA",
        [
            "EBIT",
            "EBITDA - Standard",
            "EBITDA Adjustments",
            "Adjusted EBITDA - Standard",
            "EBITDA - Reported",
            "Adjusted EBITDA - Reported",
            "Covenant EBITDA",
        ],
    ),
    (
        "MARGINS",
        [
            "EBITDA - Standard Margin %",
            "Adjusted EBITDA - Standard Margin %",
            "Adjusted EBITDA - Reported Margin %",
            "Covenant EBITDA Margin %",
        ],
    ),
]

# Balance Sheet section headers found in the CSV (ALL CAPS)
BS_SECTION_HEADERS = {"ASSETS", "LIABILITIES", "EQUITY"}

# Lines to skip entirely
SKIP_LINES = {"Income Statement", "Balance Sheet", ""}


class TemplateService:
    def __init__(self, template_path: str) -> None:
        self.template = self._load_template(template_path)

    def _load_template(self, path: str) -> Dict[str, Any]:
        template_file = Path(path)
        if not template_file.exists():
            return self._build_fallback()

        lines: List[str] = []
        with open(template_file, encoding="utf-8", newline="") as f:
            reader = csv.reader(f)
            for row in reader:
                lines.append(row[0].strip() if row else "")

        # Split into IS and BS lines
        is_lines: List[str] = []
        bs_lines: List[str] = []
        in_bs = False

        for line in lines:
            if line == "Balance Sheet":
                in_bs = True
                continue
            if line == "Income Statement":
                continue
            if in_bs:
                bs_lines.append(line)
            else:
                is_lines.append(line)

        # Build IS structure using hardcoded section map
        is_all_fields = [l for l in is_lines if l not in SKIP_LINES]
        is_field_set = set(is_all_fields)
        is_sections = []
        for header, fields in IS_SECTION_MAP:
            valid_fields = [f for f in fields if f in is_field_set]
            if not valid_fields:
                continue
            is_sections.append({"header": header, "fields": valid_fields})

        # Build BS structure using CSV section headers
        bs_all_fields: List[str] = []
        bs_sections = []
        current_header: Optional[str] = None
        current_fields: List[str] = []

        for line in bs_lines:
            if line in SKIP_LINES:
                continue
            if line in BS_SECTION_HEADERS:
                if current_header is not None or current_fields:
                    bs_sections.append({"header": current_header, "fields": current_fields})
                current_header = line
                current_fields = []
            else:
                current_fields.append(line)
                bs_all_fields.append(line)

        if current_fields:
            bs_sections.append({"header": current_header, "fields": current_fields})

        return {
            "income_statement": {
                "sections": is_sections,
                "allFields": is_all_fields,
            },
            "balance_sheet": {
                "sections": bs_sections,
                "allFields": bs_all_fields,
            },
        }

    def _build_fallback(self) -> Dict[str, Any]:
        """Minimal fallback if template CSV is missing."""
        is_all_fields = [f for _, fields in IS_SECTION_MAP for f in fields]
        is_sections = [
            {"header": h, "fields": f}
            for h, f in IS_SECTION_MAP
        ]
        return {
            "income_statement": {"sections": is_sections, "allFields": is_all_fields},
            "balance_sheet": {"sections": [], "allFields": []},
        }

    def get_template_structure(self) -> Dict[str, Any]:
        return self.template

    def get_field_order(self, statement_type: str) -> List[str]:
        return self.template.get(statement_type, {}).get("allFields", [])


# ─── Global singleton ─────────────────────────────────────────────────────────

_service: Optional[TemplateService] = None


def get_template_service() -> TemplateService:
    """Return the app-wide TemplateService singleton."""
    global _service
    if _service is None:
        _service = TemplateService(
            template_path=str(TEMPLATES_DIR / "loader_template.csv")
        )
    return _service
