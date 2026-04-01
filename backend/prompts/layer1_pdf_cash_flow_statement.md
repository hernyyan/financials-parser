# Layer 1: Cash Flow Statement Extraction (PDF Source)

You are given a PDF containing pages from a financial reporting package, along with a target reporting period. Your task is to extract all cash flow statement line items and their corresponding values for the target period into a structured JSON dictionary. Extract all operating activities, investing activities, financing activities, CAPEX, and any sub-components thereof.

## Input

**Reporting Period:** {reporting_period}

The PDF document is provided as an attachment above.

## Instructions

1. **Identify the cash flow statement.** Scan the provided pages for the cash flow statement, statement of cash flows, or consolidated cash flows. There may be multiple versions (GAAP vs. Pro Forma, Consolidated vs. Field vs. Corporate) — use the **Consolidated** or **GAAP Consolidated** version if available. If only one version exists, use that.

2. **Locate the correct column.** Using the reporting period provided, find the column that corresponds to that period. Look for columns labeled with the period month and year. Prefer "MTD" (Month-To-Date) or single-month columns over "QTD", "YTD", or "TTM" columns. The column header may appear in various date formats — for example, "July 2025" might appear as "Jul-25", "07/25", "Jul 2025", etc.

3. **Avoid the wrong columns.** Do NOT extract from columns labeled TTM (Trailing Twelve Months), LTM (Last Twelve Months), Prior Year End (PYE), YTD (Year To Date), QTD (Quarter To Date), Budget, Forecast, Plan, Prior Year, or Change. If there are multiple periods shown, extract only the target period.

4. **Extract all key-value pairs.** Return a JSON dictionary containing every line item and its value from the identified column. Include all lines from the cash flow statement section — operating activities through financing activities, plus any CAPEX or free cash flow reconciliation section if present.

5. **Preserve original labels.** Do NOT rename, reformat, or transform the line item labels from the source. Use the exact string as it appears, preserving capitalization, punctuation, and spacing.

6. **Handle unit scaling.** Check for unit indicators such as "$ in thousands", "000's", "(in millions)", etc. Normalize all monetary values to actual dollars. For example, if the document reports in thousands and shows "2,338", output `2338000`.

7. **Handle parentheses as negatives.** Values in parentheses like `(3,638,808)` represent negative numbers. Output as `-3638808`.

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
    "Net Income": 5200000,
    "Depreciation & Amortization": 1800000,
    "...": "..."
  },
  "source_scaling": "actual_dollars",
  "column_identified": "Jul-25"
}
```
