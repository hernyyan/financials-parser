"""
Python-side Excel extraction for the Layer 1 4-step pipeline.

Step A: extract_header_rows  — reads the first N rows of a sheet and returns
         them as a plain-text block for the AI column identifier.

Step C: extract_rows_with_metadata — reads the full sheet for the identified
         data column, returning one dict per row with value, formatting flags
         (bold, italic, indent), and the row label.

         rows_to_csv_with_metadata — serialises that list to a CSV string that
         the AI structured extractor can consume.
"""
from __future__ import annotations

import csv
import io
from typing import Any, Dict, List, Optional

import openpyxl
from openpyxl.styles import Font


# ── helpers ──────────────────────────────────────────────────────────────────

def _effective_font(cell) -> Font:
    """Return the cell's font, falling back to a plain Font() if absent."""
    return cell.font if cell.font else Font()


def _indent_level(cell) -> int:
    """Return the cell's alignment indent level (0 if not set)."""
    if cell.alignment and cell.alignment.indent:
        return int(cell.alignment.indent)
    return 0


def _cell_value(cell) -> Any:
    return cell.value


# ── Step A ────────────────────────────────────────────────────────────────────

def extract_header_rows(
    filepath: str,
    sheet_name: str,
    n_rows: int = 12,
) -> str:
    """
    Open the workbook and return the first *n_rows* rows of *sheet_name* as a
    plain-text block (tab-separated columns, one row per line).

    This is fed to the AI column identifier (Step B) so it can locate the
    correct period column without needing the entire sheet.
    """
    wb = openpyxl.load_workbook(filepath, read_only=True, data_only=True)
    ws = wb[sheet_name]

    lines: List[str] = []
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i >= n_rows:
            break
        cells = [str(v) if v is not None else "" for v in row]
        lines.append("\t".join(cells))

    wb.close()
    return "\n".join(lines)


# ── Step C ────────────────────────────────────────────────────────────────────

def extract_rows_with_metadata(
    filepath: str,
    sheet_name: str,
    column_index: int,       # 1-based column index of the target period
    source_scaling: str,     # 'thousands' | 'millions' | 'actual_dollars'
    skip_rows: int = 0,      # header rows to skip before data begins
) -> List[Dict[str, Any]]:
    """
    Read the full sheet and return one dict per non-empty label row with:
      - label      : str   — text from the first non-empty cell in the row
      - label_col  : int   — 1-based column index where the label was found
      - value      : float | None
      - bold       : bool
      - italic     : bool
      - indent     : int   — alignment indent level (0 = leftmost)
      - row_index  : int   — 1-based sheet row number

    Scaling is applied: values are normalised to actual dollars.
    Rows with no label text are skipped.
    """
    scale = _parse_scale(source_scaling)

    wb = openpyxl.load_workbook(filepath, read_only=False, data_only=True)
    ws = wb[sheet_name]

    rows: List[Dict[str, Any]] = []

    for row_num, row in enumerate(ws.iter_rows(), start=1):
        if row_num <= skip_rows:
            continue

        # Find label: first non-empty cell in the row
        label: Optional[str] = None
        label_col: Optional[int] = None
        label_cell = None
        for cell in row:
            if cell.value is not None and str(cell.value).strip():
                label = str(cell.value).strip()
                label_col = cell.column
                label_cell = cell
                break

        if label is None:
            continue  # blank row

        # Value from the target column
        value_cell = ws.cell(row=row_num, column=column_index)
        raw_val = _cell_value(value_cell)
        value: Optional[float] = None
        if raw_val is not None and str(raw_val).strip() not in ("", "-", "—"):
            try:
                value = float(str(raw_val).replace(",", "")) * scale
            except (ValueError, TypeError):
                value = None

        font = _effective_font(label_cell)
        rows.append({
            "label": label,
            "label_col": label_col,
            "value": value,
            "bold": bool(font.bold),
            "italic": bool(font.italic),
            "indent": _indent_level(label_cell),
            "row_index": row_num,
        })

    wb.close()
    return rows


def rows_to_csv_with_metadata(rows: List[Dict[str, Any]]) -> str:
    """
    Serialise the output of extract_rows_with_metadata to a CSV string.

    Columns: row_index, label, value, bold, italic, indent
    """
    output = io.StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=["row_index", "label", "value", "bold", "italic", "indent"],
        extrasaction="ignore",
        lineterminator="\n",
    )
    writer.writeheader()
    for r in rows:
        writer.writerow({
            "row_index": r["row_index"],
            "label": r["label"],
            "value": "" if r["value"] is None else r["value"],
            "bold": r["bold"],
            "italic": r["italic"],
            "indent": r["indent"],
        })
    return output.getvalue()


# ── internal ──────────────────────────────────────────────────────────────────

def _parse_scale(source_scaling: str) -> float:
    s = source_scaling.lower()
    if "thousand" in s:
        return 1_000.0
    if "million" in s:
        return 1_000_000.0
    return 1.0
