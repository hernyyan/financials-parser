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

Identify the single column that contains the **consolidated actual financial data** for **{reporting_period}**. Use your best judgment — every spreadsheet is different and there are no rigid rules.

**General guidance:**

- **Period match:** The column header should correspond to the target month and year. Date formats vary widely — "November 2025", "Nov-25", "11/25", "Nov 29, 2025" (end-of-month), multi-row headers (year in one row, month in another) are all common. Match by month and year regardless of exact format.

- **Actual over non-actual:** Prefer columns representing actual reported figures over Budget, Forecast, Plan, Variance, Delta, or Prior Year columns when both exist for the same period.

- **Consolidated over breakdowns:** Companies sometimes report separate columns for geographies (Americas, EMEA, APAC), segments (Enterprise, SMB), or entities alongside a consolidated total. Prefer the consolidated or total column.

- **What to avoid:** TTM, LTM, PYE, YTD, prior-year comparison, variance, and percentage columns are almost never the right answer.

These are guidelines, not strict rules. Use judgment based on what you see in the headers.

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
