# Layer 2: Cash Flow Statement — L1 Row Mapping

You are given a list of rows extracted from a company's cash flow statement (Layer 1 output). Map each standardized Layer 2 field to the single best-matching source row.

## Input

**Statement type:** {statement_type}

**Layer 1 rows (row_index | label | value):**
```
{layer1_rows}
```

## Rules

- Match each L2 field to the **single best L1 row** by label meaning and value.
- Return `null` for any field you cannot confidently match.
- Do **not** attempt multi-row mappings. One row per field only.
- Use the exact `row_index` and verbatim label from the table.

## Field Guidance

- **Operating Cash Flow (Working Capital)**: Changes in working capital — AR, AP, inventory, accruals. Map the summary line if present.
- **Operating Cash Flow (Non-Working Capital)**: Non-cash add-backs — D&A, stock comp, deferred taxes. Map the summary line if present.
- **Operating Cash Flow**: Total operating cash flow. Map only if source reports a single operating cash flow total without breaking into sub-components.
- **Investing Cash Flow**: Total investing activities (typically negative).
- **Financing Cash Flow**: Total financing activities.
- **CAPEX**: Capital expenditures line (typically negative or in parentheses).

Call the `map_l1_to_l2` tool with your mappings.
