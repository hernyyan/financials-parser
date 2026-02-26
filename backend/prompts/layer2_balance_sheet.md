# Layer 2: Balance Sheet Classification

You are given the extracted JSON output from Layer 1, containing all line items and their dollar values from a company's balance sheet. Your task is to classify each line item into the firm's standardized balance sheet template according to US GAAP standards and financial statement practice. Do not simply mirror how the source financials categorized an item. The output must be a JSON object matching the exact structure below, with dollar values populated for each applicable line item.

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

The reasoning trace must create a complete chain from every output value back to specific line items in the Layer 1 extraction. An analyst reviewing the output should be able to follow the trace from any template field to the exact source data that produced it.

## Template Structure

```json
{
  "ASSETS": {
    "Cash & Cash Equivalents": 0,
    "Short Term Investments": 0,
    "Accounts Receivable": 0,
    "Inventory": 0,
    "Prepaid Expenses": 0,
    "Other Current Assets": 0,
    "Total Current Assets": 0,
    "Property, Plant & Equipment": 0,
    "Accumulated Depreciation": 0,
    "Total Fixed Assets": 0,
    "Other Non-Current Assets": 0,
    "Goodwill & Intangibles": 0,
    "Total Non-Current Assets": 0,
    "Total Assets": 0 },
  "LIABILITIES": {
    "Accounts Payable": 0,
    "Short Term Loans": 0,
    "Short Term Capitalized Leases": 0,
    "Short Term Mortgages": 0,
    "Short Term Debt": 0,
    "Accrued Liabilities": 0,
    "Other Current Liabilities": 0,
    "Total Current Liabilities": 0,
    "Long Term Loans": 0,
    "Long Term Capitalized Leases": 0,
    "Long Term Mortgages": 0,
    "Long Term Debt": 0,
    "Deferred Liabilities": 0,
    "Other Non-Current Liabilities": 0,
    "Total Non-Current Liabilities": 0,
    "Total Liabilities": 0 },
  "EQUITY": {
    "Preferred Stock": 0,
    "Common Stock": 0,
    "Paid in Capital": 0,
    "Other Comprehensive Income": 0,
    "Retained Earnings": 0,
    "Minority Interest": 0,
    "Total Equity": 0 },
  "Total Liabilities and Equity": 0
}
```

## Classification Rules

Classify every line item from the Layer 1 extraction according to US GAAP standards. Do NOT simply mirror how the source financials categorized an item. Apply the following principles:

**General Principle — Ambiguity and the "Other" Categories**: When a line item's specific sub-type is ambiguous or unspecified, do NOT attempt to justify placing it into a specific named category. Route it to the appropriate "Other" catch-all category (Other Current Assets, Other Current Liabilities, Other Non-Current Assets, or Other Non-Current Liabilities) instead. The named categories (e.g., Short Term Loans, Long Term Capitalized Leases) require positive identification — you must be able to confirm the item matches the category definition, not merely argue it could. When in doubt, use "Other" and let the human reviewer decide. Similarly, if an item requires company-specific context or external knowledge you do not have to classify correctly, append `__FLAGGED` and route to the most likely field for human review.

**General Principle — Conflicting Signals Require Flagging**: If a line item's label contains keywords that point to two or more different template fields (e.g., "Receivables and Other Cash" references both Cash & Cash Equivalents and Accounts Receivable), this is a strong signal of ambiguous or non-standard reporting. Do NOT silently route these to an "Other" category. Instead, route to the most likely field and append `__FLAGGED` for human review. The same applies to any line item that combines concepts that would normally be classified separately — the human reviewer needs to determine how to split or classify it. When in doubt between flagging and not flagging, always flag.

**General Principle — Reasoning Integrity**: Every reasoning trace must be arithmetically verifiable. After generating reasoning, cross-check that the specific dollar amounts cited in the trace actually produce the output value when you apply the stated formula. Do NOT generate a reasoning trace that sounds plausible but does not match the math. If a line item was excluded from a calculation, the reasoning must not claim it was included. If you cannot reconcile a computed value with its components, flag the discrepancy rather than fabricating an explanation.

**Cash & Cash Equivalents**: Only include items where the company has full, immediate, unrestricted access to funds. This includes bank account balances and highly liquid instruments with original maturities of 3 months or less. Do NOT include: credit card clearing accounts, merchant processing receivables, restricted cash, or any balance where funds are in transit, held by a third party, or subject to settlement delays. These belong in Other Current Assets.

**Accounts Receivable**: Trade receivables from the sale of goods or services in the ordinary course of business. Do NOT include non-trade receivables, employee advances, or tax refund receivables — these belong in Other Current Assets.

**Inventory**: Raw materials, work-in-progress, and finished goods held for sale. Include inventory in transit only if title has transferred (FOB shipping point). Inventory deposits (prepayments to suppliers for future inventory) belong in Prepaid Expenses or Other Current Assets, not Inventory.

**Prepaid Expenses**: Advance payments for goods or services not yet received — insurance, rent, software subscriptions, deposits on future inventory purchases.

**Property, Plant & Equipment**: Tangible long-lived assets including furniture, fixtures, equipment, leasehold improvements, vehicles, and machinery. Report at gross value before depreciation.

**Accumulated Depreciation**: Report as a negative value. This is the cumulative depreciation against PP&E.

**Goodwill & Intangibles**: Combine goodwill, tradenames, customer relationships, non-compete agreements, and other identifiable intangible assets into a single net figure (gross intangibles minus accumulated amortization plus goodwill).

**Accounts Payable**: Trade payables owed to suppliers and vendors for goods and services received in the ordinary course of business. Do NOT include accrued expenses, payroll liabilities, or tax obligations.

**Short Term Loans**: ONLY include debt instruments borrowed from a lender or financial institution — revolvers, lines of credit, and current portions of long-term debt **where the debt type is explicitly identifiable** (e.g., "current portion of term loan" → Short Term Loans, "current portion of capital lease" → Short Term Capitalized Leases). If the source only says "current portion of long-term liabilities" or similar without specifying the debt type, do NOT assume it is a loan — route it to Other Current Liabilities. Do NOT include trade payables, payroll liabilities, sales tax liabilities, lease liabilities, customer deposits, gift card liabilities, deferred revenue, or any other operating liabilities. The test is simple: did the company borrow this money from a lender? If yes, Short Term Loans. If no, it belongs in Accrued Liabilities or Other Current Liabilities.

**Short Term Capitalized Leases**: Current portion of finance lease or capital lease liabilities ONLY. The source label must explicitly reference a lease — look for the words "lease," "lease liability," "lease obligation," "capital lease," or "finance lease." Do NOT classify items here based on loose association with rent, occupancy, or space. Specifically:
- "Deferred rent" is NOT a lease liability — it is a legacy straight-line rent accrual (pre-ASC 842) and belongs in Other Current Liabilities.
- "Equipment financing" is NOT a lease unless the label explicitly says so — equipment financing is a loan to purchase equipment and belongs in Short Term Loans.
- If the label says "current portion of lease" without specifying finance vs. operating, it still qualifies here — the word "lease" is the key requirement.

**Accrued Liabilities**: Obligations incurred but not yet invoiced or paid — accrued wages/payroll, accrued interest, accrued expenses. Include payroll liabilities here.

**Other Current Liabilities**: Catch-all for current obligations that don't fit the named categories above — deferred revenue, customer deposits, gift card liabilities, sales tax payable, income tax payable, earnout liabilities (current portion), deferred rent (current portion), and any other current obligations.

**Long Term Loans**: All borrowings from lenders or financial institutions due beyond 12 months. This includes term loans, senior debt, subordinated debt, seller notes, notes payable, equipment financing, and any other long-term debt instruments. Apply the same bright-line test as Short Term Loans: did the company borrow this money from a lender or counterparty? If yes and it is due beyond 12 months, it belongs here. Debt issuance costs should be netted against Long Term Loans as a negative value — under ASC 835-30, debt issuance costs are a direct deduction from the carrying amount of the related debt, not a separate deferred liability.

**Long Term Capitalized Leases**: Long-term finance lease or capital lease liabilities ONLY. The same explicit lease language requirement applies as Short Term Capitalized Leases — the source label must contain the words "lease," "lease liability," "lease obligation," "capital lease," or "finance lease." Do NOT classify items here through inference or loose association. Specifically:
- "Deferred rent" is NOT a lease liability — it is a legacy straight-line rent accrual (pre-ASC 842) and belongs in Deferred Liabilities (long-term portion) or Other Non-Current Liabilities.
- "Equipment financing" is NOT a lease unless the label explicitly says so — it is a loan and belongs in Long Term Loans.
- Do NOT assume that because something relates to occupancy, space, or rent that it is a lease. The word "lease" must appear in the label.

**Deferred Liabilities**: Deferred tax liabilities (if not classified as current), deferred rent (long-term portion — a legacy pre-ASC 842 straight-line rent accrual), and other deferred obligations. Do NOT include debt issuance costs here — those are netted against Long Term Loans.

**Other Non-Current Liabilities**: Catch-all for non-current obligations that do not fit the named categories above — deferred management fees, accrued rebate payables, and other non-current obligations. Do NOT place the following items here; they have specific homes elsewhere:
- Term loans, notes payable, seller notes, equipment financing → Long Term Loans
- Lease liabilities (must explicitly say "lease" in the label) → Long Term Capitalized Leases
- Debt issuance costs → Netted against Long Term Loans (as negative value)
- Deferred tax liabilities → Deferred Liabilities
- Deferred rent → Deferred Liabilities

**Equity**: Map equity items to the closest matching template field using these rules:

- **Preferred Stock**: Any class-designated equity — Class A, Class B, Class A-1 shares or membership units. These represent preferential equity interests.
- **Common Stock**: Basic common shares or membership units without class designations or preferential terms.
- **Paid in Capital**: Additional paid-in capital (APIC) only — capital contributed by investors or owners in excess of par value. This includes amounts explicitly labeled as additional paid-in capital, capital contributions, and LLC capital accounts. This is NOT a default bucket for equity. Do NOT route undifferentiated equity here.
- **Retained Earnings**: Accumulated retained earnings. If the source reports net income / net loss as a separate line item on the balance sheet, do NOT report it as a separate line — combine it with retained earnings into a single Retained Earnings figure. Net income is an income statement item; its only balance sheet expression is through retained earnings. **If the source reports a single undifferentiated "equity" or "total equity" line with no breakdown into component parts, classify the entire amount as Retained Earnings.** Retained Earnings is the accumulation account and the appropriate default when equity is not broken out.
- **Minority Interest**: Non-controlling interests only.

**Equity — Flagging Requirement**: If equity line items reference specific company names, investor names, or entity names (e.g., "Equity - Acme Corp", "Smith Capital Investment", "[Company] Membership Units"), these represent specific equity stakes whose classification as Preferred Stock, Common Stock, or Paid in Capital depends on the terms of the investment — context you do not have. Do NOT default these to Paid in Capital. Instead, append `__FLAGGED` to the most likely field and route for human review. The same applies to any equity item whose classification between Preferred Stock, Common Stock, and Paid in Capital is not determinable from the label alone.

## Handling Uncertainty

If a line item from the Layer 1 extraction cannot be confidently classified (i.e., the correct template category is ambiguous given the item's label and the context of the financial statements), do NOT guess. Instead, assign the value to the most likely template field and append `"__FLAGGED"` to the field name in the output JSON. For example: `"Other Current Assets__FLAGGED": 50000`. This signals the item requires human review.

## Vertical Accounting Checks

After populating all line items, verify the following. If any check fails, include a `"VALIDATION"` key in the output JSON listing each failed check with the expected vs. actual values.

1. **Total Current Assets** = Cash & Cash Equivalents + Short Term Investments + Accounts Receivable + Inventory + Prepaid Expenses + Other Current Assets
2. **Total Fixed Assets** = Property, Plant & Equipment + Accumulated Depreciation
3. **Total Non-Current Assets** = Total Fixed Assets + Other Non-Current Assets + Goodwill & Intangibles
4. **Total Assets** = Total Current Assets + Total Non-Current Assets
5. **Short Term Debt** = Accounts Payable + Short Term Loans + Short Term Capitalized Leases + Short Term Mortgages
6. **Total Current Liabilities** = Short Term Debt + Accrued Liabilities + Other Current Liabilities
7. **Long Term Debt** = Long Term Loans + Long Term Capitalized Leases + Long Term Mortgages
8. **Total Non-Current Liabilities** = Long Term Debt + Deferred Liabilities + Other Non-Current Liabilities
9. **Total Liabilities** = Total Current Liabilities + Total Non-Current Liabilities
10. **Total Equity** = Preferred Stock + Common Stock + Paid in Capital + Other Comprehensive Income + Retained Earnings + Minority Interest
11. **Total Liabilities and Equity** = Total Liabilities + Total Equity
12. **Balance check**: Total Assets = Total Liabilities and Equity

## Output Format

Return a single JSON object with the following top-level keys:

1. **Statement data**: The populated template structure shown above (ASSETS, LIABILITIES, EQUITY) with dollar values.
2. **`"REASONING"`**: A dictionary mapping each populated field name to its reasoning trace string.
3. **`"VALIDATION"`**: A dictionary mapping each validation check to its result (PASS/FAIL with details). Include all checks, not just failures.
