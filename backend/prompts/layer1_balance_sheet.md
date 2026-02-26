# Layer 1: Balance Sheet Extraction

You are given the CSV content of a balance sheet from a financial reporting package, along with a target reporting period. Your task is to extract all line items and their corresponding values for the target period into a structured JSON dictionary.

## Input

**Reporting Period:** {reporting_period}

**CSV Content:**
```
{csv_content}
```

## Instructions

1. **Locate the correct column.** Using the reporting period provided, find the column that corresponds to that period. The column header may appear in various date formats — for example, "March 2024" might appear as "03/24", "03/31/2024", "Mar 2024", "Mar-24", or the year and month may be decomposed across multiple header rows (e.g., "2024" above, "March" below).

2. **Avoid the wrong columns.** Do NOT extract from columns labeled TTM (Trailing Twelve Months), LTM (Last Twelve Months), Prior Year End (PYE), or YTD (Year To Date). If there is a "Consolidated" (or "Cons.") or "Actuals" column for the target period, prefer that column.

3. **Extract all key-value pairs.** Return a JSON dictionary containing every line item and its value from the identified column. For example: `{"Total Assets": "5000000", "Cash and Cash Equivalents": "250000"}`.

4. **Preserve original labels.** Do NOT rename, reformat, or transform the line item labels from the source. Use the exact string as it appears in the CSV, preserving capitalization, punctuation, and spacing.

5. **Handle unit scaling.** Before extracting values, check the sheet for unit indicators such as "Amount in 000's", "000's", "in 000's", "(in thousands)", "$ in 000s", "(in millions)", or similar. Determine the scaling factor for the sheet:
   - If in thousands: multiply all values by 1,000
   - If in millions: multiply all values by 1,000,000
   - If in actual dollars: use values as-is

   Normalize all monetary values to actual dollars in the output. For example, if the sheet reports "2,338" in $000s, output `2338000`. If the sheet reports "2,720,996.58" in actual dollars, output `2720996.58`.

6. **Handle dashes and blanks.** If a value is represented as "-", "—", or is blank, output `0`.

## Output Format

Return a JSON object with:
- A `line_items` key containing the dictionary of all extracted key-value pairs (line item label → dollar value as a number)
- A `source_scaling` key indicating the detected unit scaling for the sheet (e.g., "thousands", "millions", "actual_dollars")
- A `column_identified` key indicating which column header was matched to the reporting period

```json
{
  "line_items": {
    "Total Assets": 5000000,
    "Cash and Cash Equivalents": 250000,
    "...": "..."
  },
  "source_scaling": "actual_dollars",
  "column_identified": "Mar 2024"
}
```
