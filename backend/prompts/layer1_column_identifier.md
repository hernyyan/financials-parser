# Layer 1: Column Identifier (Step B)

You are analyzing the header rows of a financial statement spreadsheet to identify the correct data column and scaling.

## Input

**Reporting Period:** {reporting_period}

**Statement Type (optional):** {statement_type}

**Sheet rows (tab-separated, format `[row_num]\tcol1\tcol2\t...`):**
```
{header_rows}
```

## Task

Find the column whose header matches the reporting period **{reporting_period}** by month and year.

**Column selection rules:**
- Match the month and year. If the target is November 2025 (month=11), do NOT select October (month=10) or December (month=12).
- Common header formats: "November 2025", "Nov-25", "Nov 2025", "11/25", "11/2025", "2025-11", multi-row (year in one row, month in the next).
- **End-of-month date formats:** Headers like "November 29, 2025", "Nov 29", "Nov 29, 2025", "29-Nov-25", or "11/29/2025" mean the period *ending* that date. Match them by month — "November 29" is a valid match for "November 2025".
- **When multiple columns cover the same period** (e.g., Actual, Budget, Variance/Delta columns side by side): you MUST select the **Actual** column. Never select Budget, Forecast, Variance, or Delta columns even if they are the only labeled match.
- Do NOT select TTM, LTM, PYE, YTD, Budget, Forecast, Variance, or Prior Year columns.

**Scaling detection:**
- Look for unit indicators near the top: "in thousands", "$ in 000s", "(in millions)", etc.
- If none found, use `actual_dollars`.

**Section boundaries (only when statement_type is provided):**
- If `statement_type` is blank, set `section_start_row` and `section_end_row` to 0.
- If `statement_type` is provided, the sheet has multiple statements stacked vertically. Identify:
  - `section_start_row`: first row of actual line-item data for this statement (after its heading)
  - `section_end_row`: last data row before the next section heading (or last non-empty row)
  - Statement headings to look for: income_statement → "Income Statement", "P&L", "Profit and Loss"; balance_sheet → "Balance Sheet", "Statement of Financial Position"; cash_flow_statement → "Cash Flow Statement", "Statement of Cash Flows"
- Both values are 1-based absolute sheet row numbers.

{retry_hint}

Call the `identify_column` tool with your findings.
