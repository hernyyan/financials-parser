# Layer 1: Column Identifier (Step B)

You are given the first few rows of a financial statement spreadsheet as tab-separated text, along with a target reporting period. Your task is to identify which column contains data for that period.

## Input

**Reporting Period:** {reporting_period}

**Header rows (tab-separated):**
```
{header_rows}
```

## Instructions

1. **Find the period column.** Scan all column headers for a match to the target reporting period. The header may span multiple rows (e.g., year in row 1, month in row 2). Common date formats: "03/24", "03/31/2024", "Mar 2024", "Mar-24", "March 2024", "Q1 2024".

2. **Prefer Actuals/Consolidated.** If multiple columns match the period (e.g., "Actuals" and "Budget" both for March 2024), pick the Actuals or Consolidated column.

3. **Avoid non-period columns.** Do NOT select TTM, LTM, PYE, YTD, Budget, or Variance columns unless the target period literally matches one of those labels.

4. **Identify the scaling.** Look for unit indicators in the header rows such as "Amount in 000's", "(in thousands)", "$ in 000s", "(in millions)", or similar. If none found, assume actual dollars.

5. **Identify skip_rows.** Count how many rows are pure header rows before actual line-item data begins. Typically 1–4. This is used to skip headers when reading the full sheet.

6. **Report column_index as 1-based** (column A = 1, B = 2, etc.).

## Output Format

Return a JSON object only — no explanation, no markdown fences:

```json
{
  "column_index": 4,
  "column_letter": "D",
  "source_scaling": "thousands",
  "skip_rows": 3,
  "period_matched": "Mar-24"
}
```

`source_scaling` must be one of: `"thousands"`, `"millions"`, `"actual_dollars"`.
