# Layer 2: Balance Sheet — L1 Row Mapping

You are given a list of rows extracted from a company's balance sheet (Layer 1 output). Map each standardized Layer 2 field to the single best-matching source row.

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

### Assets
- **Cash & Cash Equivalents**: Cash and liquid equivalents line.
- **Accounts Receivable**: Trade receivables (net of allowances).
- **Inventory**: Inventory or stock line.
- **Prepaid Expenses**: Prepaid or other current assets listed as prepaid.
- **Other Current Assets**: Catch-all for remaining current assets not listed above.
- **Total Current Assets**: Subtotal line for current assets.
- **Property, Plant & Equipment**: PP&E or fixed assets (gross).
- **Accumulated Depreciation**: Depreciation reserve — report as negative. Map the line that represents accumulated/cumulative depreciation.
- **Goodwill & Intangibles**: Goodwill, intangibles, or combined line.
- **Other non-current assets**: Remaining non-current assets.
- **Total Non-Current Assets**: Subtotal for non-current/long-term assets.
- **Total Assets**: Grand total assets line.

### Liabilities
- **Accounts Payable**: Trade payables.
- **Accrued Liabilities**: Accrued expenses/liabilities.
- **Deferred Revenue**: Deferred or unearned revenue.
- **Revolver - Balance Sheet**: Only if explicitly labelled as revolver/revolving credit.
- **Current Maturities**: Current portion of long-term debt.
- **Other Current Liabilities**: Remaining current liabilities.
- **Total Current Liabilities**: Subtotal for current liabilities.
- **Long Term Loans**: Long-term debt/borrowings (>12 months).
- **Long Term Leases**: Only if the word "lease" explicitly appears in the label.
- **Other Non-Current Liabilities**: Remaining non-current liabilities.
- **Total Non-Current Liabilities**: Subtotal for non-current liabilities.
- **Total Liabilities**: Grand total liabilities line.

### Equity
- **Paid in Capital**: Paid-in/contributed capital.
- **Retained Earnings**: Retained earnings or accumulated deficit.
- **Other Equity**: Preferred stock, other equity components.
- **Total Equity**: Total shareholders equity line.
- **Total Liabilities and Equity**: Grand total line.
- **Check**: Leave null — computed automatically.

Call the `map_l1_to_l2` tool with your mappings.
