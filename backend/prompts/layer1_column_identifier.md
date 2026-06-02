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

Find the single column that contains the **consolidated actual financial data** for **{reporting_period}**.

Apply this priority ladder in order — eliminate candidates at each step, then pick the best remaining column:

**Step 1 — Match the period (month + year)**
- Headers like "November 2025", "Nov-25", "Nov 2025", "11/25", "2025-11", or multi-row (year above, month below) all match "November 2025".
- End-of-month date formats match by month: "November 29, 2025", "Nov 29", "29-Nov-25", "11/29/2025" are all valid matches for "November 2025".
- Eliminate columns for any other month or year — e.g., if target is Nov 2025, discard Oct 2025, Nov 2024, YTD, TTM, LTM, PYE, and any "Prior Year" column.

**Step 2 — Eliminate non-actual columns**
- Discard Budget, Forecast, Plan, Variance, Delta, % Change, and Prior Year columns even if their date matches.
- Keep only Actual, Reported, or unlabeled data columns.

**Step 3 — Prefer consolidated / total over sub-totals**
Multiple columns may survive steps 1–2 because the company reports by geography, segment, or business unit alongside a consolidated total. Examples:
- Geography: Americas / EMEA / APAC / **Total**
- Segment: Enterprise / SMB / Consumer / **Total**
- Entity: Subsidiary A / Subsidiary B / **Consolidated**
- In these cases, select the **Total** or **Consolidated** column (or whichever column label indicates the company-wide aggregate).
- If no explicit "Total" label exists but one column has values that appear to be the sum of the others, select that column.

**Step 4 — If still ambiguous**
- Prefer the column positioned furthest to the right among equal candidates (totals are commonly placed last).
- Use the column with the most non-empty numeric rows as a tiebreaker.

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
