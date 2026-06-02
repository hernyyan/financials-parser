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

Look at the headers and identify the column that most likely contains the consolidated, actual financial figures for **{reporting_period}**.

Every spreadsheet is laid out differently, so use your judgment. As rough guidance: you're looking for a column whose header corresponds to the right month and year — date formats vary widely and may include end-of-month dates (e.g. "Nov 29" meaning the period ending November), multi-row headers, or abbreviated formats. When there are multiple columns for the same period — such as actual vs. budget, year-over-year comparisons, geographic or segment breakdowns — you generally want the one representing consolidated actuals for the target period. Columns like TTM, LTM, YTD, variance, prior year, budget, or percentage change are usually not what you want.

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
