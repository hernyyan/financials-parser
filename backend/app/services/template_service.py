"""
Template service — loads and parses the firm's standardized output template.
Provides the canonical field ordering used to render template tables in the UI.
"""
import csv
import re
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, FrozenSet, List, Optional

from app.config import TEMPLATES_DIR

STATEMENT_MARKERS = frozenset({"Income Statement", "Balance Sheet", "Cash Flow Statement"})


@dataclass
class TemplateField:
    name: str
    section: str        # _g1-_g8 for unnamed IS groups, named section or "" for CFS
    blank_row_before: bool


def _is_section_header(f: TemplateField) -> bool:
    """A row is a named section header when its field name equals its section (e.g. ASSETS, LTM...)."""
    return bool(f.section) and f.name == f.section


def _build_sections(rows: List[TemplateField]) -> List[Dict[str, Any]]:
    """
    Group TemplateField rows into sections preserving CSV order.
    - Section header rows (field==section) become the header of their group.
    - _gN-prefixed sections produce {header: None, fields: [...]}.
    - Named sections (ASSETS, LTM...) produce {header: "name", fields: [...]}.
    """
    groups: OrderedDict[str, Dict[str, Any]] = OrderedDict()

    for f in rows:
        key = f.section or "_default"
        is_header = _is_section_header(f)

        if key not in groups:
            if is_header:
                groups[key] = {"header": f.name, "fields": []}
            else:
                groups[key] = {"header": None, "fields": []}

        if not is_header:
            groups[key]["fields"].append(f.name)

    return [g for g in groups.values() if g["fields"]]


class TemplateService:
    def __init__(self, template_path: str) -> None:
        self.template, self.blank_row_before_fields = self._load_template(template_path)

    def _load_template(self, path: str):
        template_file = Path(path)
        if not template_file.exists():
            return self._build_fallback()

        is_rows: List[TemplateField] = []
        bs_rows: List[TemplateField] = []
        cfs_rows: List[TemplateField] = []
        blank_row_before: set = set()
        current_stmt: Optional[str] = None

        with open(template_file, encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                field = row.get("field", "").strip()
                section = row.get("section", "").strip()
                brb = row.get("blank_row_before", "").strip() == "1"

                if not field:
                    continue

                if field in STATEMENT_MARKERS:
                    current_stmt = field
                    if brb:
                        blank_row_before.add(field)
                    continue

                if brb:
                    blank_row_before.add(field)

                tf = TemplateField(name=field, section=section, blank_row_before=brb)

                if current_stmt == "Income Statement":
                    is_rows.append(tf)
                elif current_stmt == "Balance Sheet":
                    bs_rows.append(tf)
                elif current_stmt == "Cash Flow Statement":
                    cfs_rows.append(tf)

        is_sections = _build_sections(is_rows)
        is_all_fields = [f.name for f in is_rows if not _is_section_header(f)]

        bs_sections = _build_sections(bs_rows)
        bs_all_fields = [f.name for f in bs_rows if not _is_section_header(f)]

        cfs_all_fields = [f.name for f in cfs_rows]
        cfs_sections = [{"header": None, "fields": cfs_all_fields}] if cfs_all_fields else []

        template = {
            "income_statement": {"sections": is_sections, "allFields": is_all_fields},
            "balance_sheet": {"sections": bs_sections, "allFields": bs_all_fields},
            "cash_flow_statement": {"sections": cfs_sections, "allFields": cfs_all_fields},
        }
        return template, frozenset(blank_row_before)

    def _build_fallback(self):
        """Minimal fallback if template CSV is missing."""
        fallback_is_groups = [
            ("_g1", ["Total Revenue", "COGS"]),
            ("_g2", ["Gross Profit"]),
            ("_g3", ["Total Operating Expenses"]),
            ("_g4", ["EBITDA - Standard"]),
            ("_g5", ["EBITDA Adjustments"]),
            ("_g6", ["Adjusted EBITDA - Standard"]),
            ("_g7", ["Depreciation & Amortization", "Interest Expense/(Income)", "Other Expense / (Income)", "Taxes"]),
            ("_g8", ["Net Income (Loss)"]),
            ("LTM - Adj EBITDA items", ["Equity Cure", "Adjusted EBITDA - Including Cures", "Covenant EBITDA"]),
        ]
        is_all_fields = [f for _, fields in fallback_is_groups for f in fields]
        is_sections = [
            {"header": None if key.startswith("_") else key, "fields": fields}
            for key, fields in fallback_is_groups
        ]
        return (
            {
                "income_statement": {"sections": is_sections, "allFields": is_all_fields},
                "balance_sheet": {"sections": [], "allFields": []},
                "cash_flow_statement": {"sections": [], "allFields": []},
            },
            frozenset({
                "Total Revenue", "LTM - Adj EBITDA items", "Balance Sheet",
                "Property, Plant & Equipment", "LIABILITIES", "Total Current Liabilities",
                "Long Term Loans", "EQUITY", "Cash Flow Statement", "CAPEX",
            }),
        )

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
