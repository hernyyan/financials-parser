# Layer 2: Income Statement — L1 Row Mapping

You are given a list of rows extracted from a company's income statement (Layer 1 output). Map each standardized Layer 2 field to the single best-matching source row.

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

- **Total Revenue**: Net revenue preferred; primary top-line figure.
- **COGS**: Direct cost line directly below revenue.
- **Gross Profit**: Only if explicitly labelled as gross profit in source.
- **Total Operating Expenses**: Summary/total OpEx line.
- **EBITDA - Standard**: Only if source explicitly reports EBITDA.
- **EBITDA Adjustments**: Only if source explicitly reports add-backs.
- **Adjusted EBITDA - Standard**: Only if explicitly reported.
- **Depreciation & Amortization**: Separately reported D&A line only.
- **Interest Expense/(Income)**: Net interest line.
- **Other Expense / (Income)**: Non-operating items not captured elsewhere.
- **Taxes**: Income tax expense.
- **Net Income (Loss)**: Bottom-line net income/loss.
- **LTM - Adj EBITDA items**, **Equity Cure**, **Adjusted EBITDA - Including Cures**, **Covenant EBITDA**: Null unless explicitly present.

Call the `map_l1_to_l2` tool with your mappings.
