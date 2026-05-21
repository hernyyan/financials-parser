# Layer 1: Column Identifier (Step B)

You are given the first rows of a financial statement spreadsheet (tab-separated, with 1-based row numbers prepended) and a target reporting period. Identify the exact column — and, if a statement type is provided, the section row range for that statement.

## Input

**Reporting Period:** {reporting_period}

**Statement Type (optional):** {statement_type}

**Sheet rows (format: `[row_num]\tcol1\tcol2\t...`):**
```
{header_rows}
```

## Instructions

### Step 1 — Parse the reporting period

Extract the **month** and **year** from the reporting period. Examples:
- "October 2024" → month=10, year=2024
- "March 2025" → month=3, year=2025
- "September 2024" → month=9, year=2024

### Step 2 — Find the period column

Scan every column header for a match to **that specific month and year**. Common formats:
- Full: "October 2024", "October 31, 2024", "10/31/2024"
- Short: "Oct-24", "Oct 24", "10/24", "Oct 2024"
- Numeric: "10/2024", "2024-10"
- Multi-row: year in one row ("2024"), month in the row below ("October" or "Oct")

**Exact month match is mandatory.** If the target is October (month=10), do NOT select September (month=9) or November (month=11).

### Step 3 — Prefer Actuals/Consolidated

If multiple columns match the same period (e.g., "Actuals" and "Budget"), pick the Actuals or Consolidated column.

### Step 4 — Exclude non-period columns

Do NOT select TTM, LTM, PYE, YTD, Budget, Variance, or Prior Year columns.

### Step 5 — Detect scaling

Look for unit indicators such as "Amount in 000's", "(in thousands)", "$ in 000s", "(in millions)". If none found, assume actual dollars.

### Step 6 — Section boundaries (only when statement_type is provided)

**Skip this step if statement_type is blank or not provided.** Set `section_start_row` and `section_end_row` to 0.

If statement_type IS provided, the sheet contains multiple statements stacked vertically. Find the section for the requested statement type:

| statement_type | Look for |
|---|---|
| `income_statement` | "Income Statement", "P&L", "Profit and Loss", "Statement of Operations" |
| `balance_sheet` | "Balance Sheet", "Statement of Financial Position" |
| `cash_flow_statement` | "Cash Flow Statement", "Cash Flows", "Statement of Cash Flows" |

- `section_start_row`: first row containing actual line-item data for this statement (after its heading and any column-header rows)
- `section_end_row`: last data row of this statement — the row just before the next section heading, or the last non-empty row

Both values are 1-based absolute sheet row numbers.

### Step 7 — Confirm your answer

Before returning:
1. Confirm the chosen column matches the target month exactly.
2. If section bounds were computed, confirm `section_start_row` is the first data row (not a heading) and `section_end_row` is the last data row of the section.

## Output

Return a JSON object only — no explanation, no markdown fences:

```json
{
  "column_index": 4,
  "column_letter": "D",
  "source_scaling": "thousands",
  "skip_rows": 0,
  "period_matched": "Oct-24",
  "section_start_row": 0,
  "section_end_row": 0
}
```

`source_scaling` must be one of: `"thousands"`, `"millions"`, `"actual_dollars"`.
`column_index` is 1-based (column A = 1, B = 2, etc.).
`section_start_row` and `section_end_row` are 0 when not applicable.
