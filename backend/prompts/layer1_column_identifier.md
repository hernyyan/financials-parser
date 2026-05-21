# Layer 1: Column Identifier

You receive the first rows of a financial statement spreadsheet (tab-separated, with 1-based row numbers prepended) and a target reporting period. Identify the exact column for that period — and, if a statement type is provided, the row range for that statement's section.

## Input

**Reporting Period:** {reporting_period}

**Statement Type (optional):** {statement_type}

**Sheet rows (`[row_num]\tcol1\tcol2\t...`):**
```
{header_rows}
```

## What to do (think silently, output only JSON)

Parse the reporting period into month and year (e.g. "October 2024" → month=10, year=2024). Scan every column header for an exact match to that month AND year. Headers may appear as full names ("October 2024", "10/31/2024"), short forms ("Oct-24", "10/24"), or split across two rows (year in one row, month in the row below). Exact month match is required — do not select a neighboring month.

When multiple columns match the period, prefer Actuals or Consolidated over Budget/Forecast. Never select TTM, LTM, PYE, YTD, Variance, or Prior Year columns.

Detect the sheet's scale from indicators like "Amount in 000's", "(in thousands)", "$ in 000s", "(in millions)". If none found, the scale is `actual_dollars`. Allowed values: `"thousands"`, `"millions"`, `"actual_dollars"`.

If `statement_type` is non-empty, the sheet stacks multiple statements vertically. Find the section for that type using these heading cues:

| statement_type | Heading cues |
|---|---|
| `income_statement` | "Income Statement", "P&L", "Profit and Loss", "Statement of Operations" |
| `balance_sheet` | "Balance Sheet", "Statement of Financial Position" |
| `cash_flow_statement` | "Cash Flow Statement", "Cash Flows", "Statement of Cash Flows" |

`section_start_row` = first row of actual line-item data for this section (after its heading and any column-header rows). `section_end_row` = last data row of this section. Both are 1-based absolute sheet row numbers. **If `statement_type` is empty, set both to `0`.**

## Output

Respond with a single JSON object and nothing else — no explanation, no markdown fences, no preamble. Begin your response with `{` as the very first character.

The object must have exactly these keys:

```
{
  "column_index": <integer, 1-based; A=1, B=2, ...>,
  "column_letter": <string, e.g. "D">,
  "source_scaling": <"thousands" | "millions" | "actual_dollars">,
  "skip_rows": <integer, usually 0>,
  "period_matched": <string, the header text that matched, e.g. "Oct-24">,
  "section_start_row": <integer, 0 if statement_type is empty>,
  "section_end_row": <integer, 0 if statement_type is empty>
}
```
