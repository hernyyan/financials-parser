# Layer 1: Balance Sheet Extraction (PDF Source)

You are given a PDF containing pages from a financial reporting package, along with a target reporting period. Your task is to extract all balance sheet line items and their corresponding values for the target period into a structured JSON dictionary.

## Input

**Reporting Period:** {reporting_period}

The PDF document is provided as an attachment above.

## Instructions

1. **Identify the balance sheet.** Scan the provided pages for the balance sheet or consolidated balance sheet. If multiple versions exist (GAAP vs. Pro Forma), use the **GAAP** or **Consolidated** version.

2. **Locate the correct column.** Using the reporting period provided, find the column that corresponds to that period. The column header may appear in various date formats — "July 2025" might appear as "Jul-25", "07/31/2025", "Jul 2025", etc. For balance sheets, the period typically represents an as-of date (end of month).

3. **Avoid the wrong columns.** Do NOT extract from columns labeled "Audited", "Prior Year", "Budget", or comparison period columns unless they match the target period. If the target period column is labeled "Current Year" or similar, use that.

4. **Extract all key-value pairs.** Return a JSON dictionary containing every line item and its value from the identified column. Include all lines: assets, liabilities, and equity.

5. **Preserve original labels.** Do NOT rename, reformat, or transform the line item labels from the source. Use the exact string as it appears, preserving capitalization, punctuation, and spacing.

6. **Handle unit scaling.** Check for unit indicators such as "$ in thousands", "000's", "(in millions)", etc. Normalize all monetary values to actual dollars.

7. **Handle parentheses as negatives.** Values in parentheses represent negative numbers. Output as negative values.

8. **Handle dashes and blanks.** If a value is represented as "-", "—", or is blank, output `0`.

9. **Dollar signs and commas.** Strip dollar signs and commas. Output clean numbers.

## Output Format

Return a JSON object with:
- A `line_items` key containing the dictionary of all extracted key-value pairs (line item label → dollar value as a number)
- A `source_scaling` key indicating the detected unit scaling (e.g., "thousands", "millions", "actual_dollars")
- A `column_identified` key indicating which column header was matched to the reporting period

```json
{
  "line_items": {
    "Cash": 30940312,
    "Accounts Receivable, net of allowance": 200262656,
    "...": "..."
  },
  "source_scaling": "actual_dollars",
  "column_identified": "Jul-25"
}
```
