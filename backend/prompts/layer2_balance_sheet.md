# Layer 2: Balance Sheet Classification

You are given the extracted JSON output from Layer 1, containing all line items and their dollar values from a company's balance sheet. Your task is to classify each line item into the firm's standardized balance sheet template. The output must be a JSON object matching the exact structure below, with dollar values populated for each applicable line item.

## Input

**Layer 1 Extracted Data:**
```json
{layer1_output}
```

## Reasoning Traces

For every populated field in the output, include a corresponding entry in a `"REASONING"` key in the output JSON. Each entry must explain:

1. **For directly classified items**: Which source line item(s) from the Layer 1 extraction were mapped to this field, and why.
2. **For calculated/subtotal fields**: The exact formula used, the specific source values that fed into it, and the resulting calculation.
3. **For flagged items**: Why the item was flagged — what made the classification ambiguous or uncertain.

The reasoning trace must create a complete chain from every output value back to specific line items in the Layer 1 extraction.

**Reasoning Integrity**: Every reasoning trace must be arithmetically verifiable. If the math doesn't add up, flag the discrepancy rather than fabricating an explanation.

## Template Structure

```json
{
  "ASSETS": {
    "Cash & Cash Equivalents": null,
    "Accounts Receivable": null,
    "Inventory": null,
    "Prepaid Expenses": null,
    "Other Current Assets": null,
    "Total Current Assets": null,
    "Property, Plant & Equipment": null,
    "Accumulated Depreciation": null,
    "Goodwill & Intangibles": null,
    "Other non-current assets": null,
    "Total Non-Current Assets": null,
    "Total Assets": null
  },
  "LIABILITIES": {
    "Accounts Payable": null,
    "Accrued Liabilities": null,
    "Deferred Revenue": null,
    "Revolver - Balance Sheet": null,
    "Current Maturities": null,
    "Other Current Liabilities": null,
    "Total Current Liabilities": null,
    "Long Term Loans": null,
    "Long Term Leases": null,
    "Other Non-Current Liabilities": null,
    "Total Non-Current Liabilities": null,
    "Total Liabilities": null
  },
  "EQUITY": {
    "Paid in Capital": null,
    "Retained Earnings": null,
    "Other Equity": null,
    "Total Equity": null
  },
  "Total Liabilities and Equity": null,
  "Check": null
}
```

All fields default to `null`. Only populate a field if the source data supports it. `null` means unmapped/not reported. `0` means the source explicitly reported zero.

## Classification Rules

### ASSETS

**Cash & Cash Equivalents**: Items where the company has full, immediate, unrestricted access to funds. Includes bank account balances and highly liquid instruments with original maturities of 3 months or less. Do NOT include restricted cash, merchant processing receivables, or credit card clearing accounts — those belong in Other Current Assets.

**Accounts Receivable**: Trade receivables from the sale of goods or services in the ordinary course of business. Do NOT include non-trade receivables, employee advances, or tax refund receivables — those belong in Other Current Assets.

**Inventory**: Raw materials, work-in-progress, and finished goods held for sale.

**Prepaid Expenses**: Advance payments for goods or services not yet received — insurance, rent, software subscriptions, deposits.

**Other Current Assets**: Catch-all for current assets not captured above. Includes short-term investments, non-trade receivables, restricted cash (current portion), tax receivables, and any other current assets.

**Total Current Assets**: **Computed.** Sum of Cash & Cash Equivalents + Accounts Receivable + Inventory + Prepaid Expenses + Other Current Assets.

**Property, Plant & Equipment**: Tangible long-lived assets — furniture, fixtures, equipment, leasehold improvements, vehicles, machinery. Report at gross value before depreciation.

**Accumulated Depreciation**: Report as a negative value. Cumulative depreciation against PP&E.

**Goodwill & Intangibles**: Combine goodwill, tradenames, customer relationships, non-compete agreements, and other identifiable intangible assets into a single net figure (gross intangibles minus accumulated amortization plus goodwill).

**Other non-current assets**: Catch-all for non-current assets not captured above. Includes long-term investments, deferred tax assets, right-of-use assets, and any other non-current items.

**Total Non-Current Assets**: **Computed.** Property, Plant & Equipment + Accumulated Depreciation + Goodwill & Intangibles + Other non-current assets.

**Total Assets**: **Computed.** Total Current Assets + Total Non-Current Assets.

### LIABILITIES

**Accounts Payable**: Trade payables owed to suppliers and vendors for goods and services received. Do NOT include accrued expenses, payroll liabilities, or tax obligations.

**Accrued Liabilities**: Obligations incurred but not yet invoiced or paid — accrued wages/payroll, accrued interest, accrued expenses, payroll liabilities.

**Deferred Revenue**: Payments received for goods or services not yet delivered. Includes customer deposits, prepaid service contracts, and gift card liabilities. Only the current portion — long-term deferred revenue belongs in Other Non-Current Liabilities.

**Revolver - Balance Sheet**: Outstanding balance on revolving credit facilities or lines of credit. The source label must explicitly reference a revolver, revolving credit, or line of credit. Do NOT classify term loan balances or other debt instruments here. If the source reports a revolver with no indication of current vs. long-term, classify the full amount here (revolvers are typically current or available instruments). If uncertain whether a debt instrument is a revolver, route to Current Maturities or Other Current Liabilities and flag.

**Current Maturities**: Current portion of long-term debt — the amount of term loans, notes payable, equipment financing, capital leases, mortgages, and other long-term debt instruments due within 12 months. This is the consolidated current debt bucket (excluding revolver). If the source reports "current portion of long-term debt" or "current maturities of long-term debt" without specifying the debt type, classify it here. If the source breaks out current portions by type (e.g., "current portion of term loan", "current portion of capital lease"), sum them all into this field.

**Other Current Liabilities**: Catch-all for current obligations not captured above — sales tax payable, income tax payable, earnout liabilities (current), deferred rent (current), and any other current obligations. Also include any current debt items that don't clearly qualify as Revolver or Current Maturities.

**Total Current Liabilities**: **Computed.** Accounts Payable + Accrued Liabilities + Deferred Revenue + Revolver - Balance Sheet + Current Maturities + Other Current Liabilities.

**Long Term Loans**: All borrowings from lenders or financial institutions due beyond 12 months. Includes term loans, senior debt, subordinated debt, seller notes, notes payable, and equipment financing. Debt issuance costs should be netted against Long Term Loans as a negative value (per ASC 835-30). Do NOT include lease liabilities here.

**Long Term Leases**: Long-term finance lease and operating lease liabilities (the non-current portion). The source label must reference "lease," "lease liability," "lease obligation," "capital lease," "finance lease," or "operating lease." Do NOT classify items here through inference — the word "lease" must appear. Deferred rent is NOT a lease liability (it belongs in Other Non-Current Liabilities).

**Other Non-Current Liabilities**: Catch-all for non-current obligations not captured above — deferred tax liabilities, deferred rent, deferred management fees, long-term deferred revenue, and any other non-current obligations.

**Total Non-Current Liabilities**: **Computed.** Long Term Loans + Long Term Leases + Other Non-Current Liabilities.

**Total Liabilities**: **Computed.** Total Current Liabilities + Total Non-Current Liabilities.

### EQUITY

**Paid in Capital**: Additional paid-in capital (APIC) — capital contributed by investors or owners in excess of par value. Includes amounts labeled as capital contributions and LLC capital accounts.

**Retained Earnings**: Accumulated retained earnings. If the source reports net income / net loss as a separate line item on the balance sheet, combine it with retained earnings — net income's only balance sheet expression is through retained earnings. **If the source reports a single undifferentiated "equity" or "total equity" line with no breakdown, classify the entire amount as Retained Earnings.**

**Other Equity**: Catch-all for equity components not captured above. Includes preferred stock, common stock, other comprehensive income (OCI), minority/non-controlling interests, treasury stock, and any class-designated equity (Class A, Class B shares). If equity line items reference specific company names or investor names, classify here and append `__FLAGGED`.

**Total Equity**: **Computed.** Paid in Capital + Retained Earnings + Other Equity.

**Total Liabilities and Equity**: **Computed.** Total Liabilities + Total Equity.

**Check**: **Computed.** Total Assets − Total Liabilities and Equity. This should always equal 0. Any nonzero value indicates a classification error. If Check ≠ 0, append `__FLAGGED` and note the imbalance in reasoning.

## Handling Uncertainty

If a line item cannot be confidently classified, assign the value to the most likely template field and append `"__FLAGGED"` to the field name in the output JSON. When in doubt between a named category and "Other," use "Other" and let the human reviewer decide.

## Vertical Accounting Checks

After populating all fields, verify the following. Allow ±$1 tolerance for rounding. Include a `"VALIDATION"` key listing each check with PASS/FAIL and details.

### Assets
1. **Total Current Assets** = Cash & Cash Equivalents + Accounts Receivable + Inventory + Prepaid Expenses + Other Current Assets
2. **Total Non-Current Assets** = Property, Plant & Equipment + Accumulated Depreciation + Goodwill & Intangibles + Other non-current assets
3. **Total Assets** = Total Current Assets + Total Non-Current Assets

### Liabilities
4. **Total Current Liabilities** = Accounts Payable + Accrued Liabilities + Deferred Revenue + Revolver - Balance Sheet + Current Maturities + Other Current Liabilities
5. **Total Non-Current Liabilities** = Long Term Loans + Long Term Leases + Other Non-Current Liabilities
6. **Total Liabilities** = Total Current Liabilities + Total Non-Current Liabilities

### Equity
7. **Total Equity** = Paid in Capital + Retained Earnings + Other Equity

### Balance
8. **Total Liabilities and Equity** = Total Liabilities + Total Equity
9. **Check** = Total Assets − Total Liabilities and Equity = 0

### Cross-Verification
10. If the source reports its own total for any subtotal field (e.g., Total Current Assets, Total Liabilities), compare against the computed value. Flag any discrepancy.

## Company-Specific Classification Rules

{company_context}

If the section above contains rules, they are specific to this company and were derived from analyst corrections on prior reporting periods. Apply these rules when relevant — they take precedence over the general classification rules when they conflict on company-specific terminology or categorization. They do NOT override basic arithmetic or validation checks.

If the section above is empty, ignore this section entirely.

## Output Format

Return a single JSON object with the following top-level keys:

1. **Statement data**: The populated template structure shown above (ASSETS, LIABILITIES, EQUITY, Total Liabilities and Equity, Check) with values (numbers or null).
2. **`"REASONING"`**: A dictionary mapping each populated field name to its reasoning trace string.
3. **`"VALIDATION"`**: A dictionary mapping each validation check to its result (PASS/FAIL with details). Include all checks, not just failures.
