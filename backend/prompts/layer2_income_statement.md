# Layer 2: Income Statement Classification

You are given the extracted JSON output from Layer 1, containing all line items and their dollar values from a company's income statement. Your task is to classify each line item into the firm's standardized income statement template according to US GAAP standards and financial statement practice. Do not simply mirror how the source financials categorized an item. The output must be a JSON object matching the exact structure below, with dollar values populated for each applicable line item. Many line items will be left at 0 — this is expected, as most companies do not report at this level of granularity.

## Input

**Layer 1 Extracted Data:**
```json
{layer1_output}
```

## Reasoning Traces

For every populated field in the output, include a corresponding entry in a `"REASONING"` key in the output JSON. Each entry must explain:

1. **For directly classified items**: Which source line item(s) from the Layer 1 extraction were mapped to this field, and why.
2. **For calculated/subtotal fields**: The exact formula used, the specific source values that fed into it, and the resulting calculation. For example: `"Gross Profit": "Total Revenue ($5,000,000) - COGS ($3,200,000) = $1,800,000. Source line items: 'Net Sales' ($5,000,000) → Total Revenue; 'Cost of Sales' ($3,200,000) → COGS."`
3. **For backward-induced values**: The margin or percentage used, the base value, and the computation. For example: `"Gross Profit": "Backward-induced from Gross Profit Margin (36%) × Total Revenue ($5,000,000) = $1,800,000. Source reported margin as 'Gross Margin: 36%' with no dollar amount."`
4. **For verified values**: If a value was verified through multiple computation paths or against the source document, note all methods used and whether they agreed. If they disagreed, explain the discrepancy.

The reasoning trace must create a complete chain from every output value back to specific line items in the Layer 1 extraction. An analyst reviewing the output should be able to follow the trace from any template field to the exact source data that produced it.

## Template Structure

```json
{
  "REVENUE": {
    "Gross Revenue": 0,
    "Net Revenue": 0,
    "Total Revenue": 0 },
  "COST OF GOODS SOLD": {
    "COGS": 0,
    "COGS - Depreciation & Amortization": 0,
    "Gross Profit": 0,
    "Gross Profit Margin %": 0 },
  "OPERATING EXPENSES": {
    "Sales & Marketing Expenses": 0,
    "Administrative Expenses": 0,
    "Compensation & Benefits Expense": 0,
    "Research & Development": 0,
    "Rent Expense": 0,
    "Management Fee Expense": 0,
    "Other Operating Expenses": 0,
    "Total Operating Expenses": 0 },
  "Net Operating Income": 0,
  "BELOW THE LINE": {
    "Depreciation & Amortization": 0,
    "Loss/(Gain) on Assets, Debt, FX": 0,
    "Non-Operating Expenses": 0,
    "Non-Operating Expenses - Depreciation & Amortization": 0,
    "Interest Expense/(Income)": 0,
    "Other Income": 0,
    "Other Expenses": 0,
    "Total Expense/(Income)": 0 },
  "PRE-TAX AND NET INCOME": {
    "Income (Loss) Before Taxes": 0,
    "Taxes": 0,
    "Net Income (Loss)": 0 },
  "EBITDA": {
    "EBIT": 0,
    "EBITDA - Standard": 0,
    "EBITDA Adjustments": 0,
    "Adjusted EBITDA - Standard": 0,
    "EBITDA - Reported": 0,
    "Adjusted EBITDA - Reported": 0,
    "Covenant EBITDA": 0 },
  "MARGINS": {
    "EBITDA - Standard Margin %": 0,
    "Adjusted EBITDA - Standard Margin %": 0,
    "Adjusted EBITDA - Reported Margin %": 0,
    "Covenant EBITDA Margin %": 0 }
}
```

## Classification Rules

Classify every line item from the Layer 1 extraction according to US GAAP standards. Do NOT simply mirror how the source financials categorized an item. Apply the following principles:

**General Principle — Best Effort with Analyst Review**: The income statement involves significantly more subjectivity than the balance sheet, particularly in the below-the-line section and EBITDA calculations. Make a best effort classification based on available information, but err on the side of flagging items for analyst review rather than making uncertain judgment calls. Many fields — particularly EBITDA Adjustments, Adjusted EBITDA (both Standard and Reported), and Covenant EBITDA — are inherently analyst-populated and should only be filled if the source document explicitly provides them.

**General Principle — Respect Source Document Placement**: When classifying income statement line items, the item's placement within the source document's own structure is a strong signal. If the source document lists an item within its operating expenses section, classify it as an operating expense — do NOT reroute it to a below-the-line category simply because the label contains words like "income," "gain," or "other." The source document's structure reflects the company's own judgment about where an item belongs operationally, and that should be respected unless there is a clear US GAAP reason to override it. When in doubt about whether an item is operating or non-operating, keep it where the source placed it and flag for analyst review.

**General Principle — Reasoning Integrity**: Every reasoning trace must be arithmetically verifiable. After generating reasoning, cross-check that the specific dollar amounts cited in the trace actually produce the output value when you apply the stated formula. Do NOT generate a reasoning trace that sounds plausible but does not match the math. If a line item was excluded from a calculation, the reasoning must not claim it was included. If you cannot reconcile a computed value with its components, flag the discrepancy rather than fabricating an explanation.

**General Principle — Many Fields Will Be Blank**: Most companies do not report at the granularity of this template. Gross Revenue, COGS - Depreciation & Amortization, Research & Development, Non-Operating Expenses - D&A, and many other fields will frequently be 0. Do NOT force values into fields that the source does not support. A field left at 0 is correct when the source does not report it.

**General Principle — Backward-Induction from Margins and Percentages**: Companies sometimes report a margin percentage instead of, or in addition to, a dollar amount. When the source reports a margin % but not the corresponding dollar amount, compute the implied dollar value using the margin and the relevant base:
- Gross Profit = Gross Profit Margin % × Total Revenue
- EBITDA = EBITDA Margin % × Total Revenue
- And so on for any margin/dollar pair in the template.

If the source reports both a margin % and a dollar amount, verify that they are consistent (dollar amount ÷ Total Revenue ≈ reported margin %). If they are inconsistent, populate both as reported and append `__FLAGGED` to both fields.

**General Principle — Multi-Path Verification and Source Reconciliation**: Wherever a value can be computed through more than one method, verify it using all available methods. For example:
- Gross Profit can be verified as Total Revenue - COGS, and also checked against Gross Profit Margin % × Total Revenue, and also compared to the source document's reported Gross Profit.
- Net Income can be verified as Income Before Taxes - Taxes, and also compared to the source.
- EBIT can be verified as Net Income + Taxes + Interest, and also as Income Before Taxes + Interest.

If multiple computation paths produce different results, or if a computed value differs from the source document's reported value, populate the value and append `__FLAGGED` with a note describing the discrepancy. Do NOT silently choose one value over another — surface the conflict for analyst review.

### Revenue

**Gross Revenue**: Total sales before any deductions (returns, discounts, allowances). Most companies do not report this separately — if the source only reports a single revenue line, leave Gross Revenue at 0 and populate Net Revenue / Total Revenue instead.

**Net Revenue**: Revenue after returns, discounts, and allowances. This is the most commonly reported revenue figure.

**Total Revenue**: In nearly all cases, Total Revenue equals Net Revenue. If Gross Revenue is reported, Total Revenue = Net Revenue. If only a single revenue figure is reported, it populates both Net Revenue and Total Revenue.

### Cost of Goods Sold

**COGS**: Direct costs attributable to the production of goods or delivery of services sold. Includes materials, direct labor, and manufacturing overhead. If the source includes depreciation within COGS and breaks it out separately, use the COGS figure excluding D&A and populate COGS - D&A separately. If D&A is not broken out from COGS, report the full COGS figure here.

**COGS - Depreciation & Amortization**: D&A specifically embedded within cost of goods sold. Only populate if the source explicitly breaks this out from COGS. Most companies do not — this field will frequently be 0.

**Gross Profit**: Revenue minus cost of goods sold.

**Gross Profit Margin %**: Gross Profit ÷ Total Revenue × 100. If the source reports this as a percentage instead of reporting Gross Profit as a dollar amount, use backward-induction to compute the dollar amount.

### Operating Expenses

**Sales & Marketing Expenses**: Advertising, marketing, sales commissions, promotional costs, and direct selling expenses.

**Administrative Expenses**: General and administrative overhead — office expenses, professional fees (legal, audit, consulting), insurance, and other corporate overhead not directly tied to production or sales. Note: if the source reports a combined "SG&A" line with no further breakdown, classify the entire amount here rather than splitting arbitrarily between Sales & Marketing and Administrative.

**Compensation & Benefits Expense**: Salaries, wages, bonuses, payroll taxes, health insurance, retirement contributions, and other employee-related costs. Only populate if the source reports compensation as a separate line. If compensation is embedded in other categories (e.g., included in SG&A or Administrative), do NOT attempt to extract it — leave at 0.

**Research & Development**: Costs directly related to R&D activities. Rarely reported by lower middle market companies — will frequently be 0.

**Rent Expense**: Lease and occupancy costs. Only populate if the source reports rent as a separate line item. If embedded in other operating expenses, leave at 0.

**Management Fee Expense**: Management or advisory fees paid to the PE sponsor or management company. Only populate if the source explicitly reports this.

**Other Operating Expenses**: Catch-all for operating expenses that do not fit the named categories above. Includes any operating expense line items not otherwise classified. Important: if the source document includes a line labeled "Other Income & Expense," "Other Income/Expense," or similar combined labels within its operating section, classify the full amount here — do NOT split it or reroute the "income" portion below the line. A negative value in this field simply means the net effect reduced operating expenses. Respect the source document's placement of the item.

**Total Operating Expenses**: Sum of all operating expense line items above.

### Net Operating Income

**Net Operating Income**: Gross Profit - Total Operating Expenses. This represents operating earnings before below-the-line items.

### Below the Line

**Depreciation & Amortization**: D&A expense that is NOT included in COGS. This is the primary D&A line for EBITDA purposes. If the source only reports a single D&A line with no indication of where it sits, classify it here (not in COGS - D&A).

**Loss/(Gain) on Assets, Debt, FX**: Non-recurring or non-operating gains and losses — asset disposals, debt extinguishment, foreign exchange gains/losses. Report losses as positive, gains as negative.

**Non-Operating Expenses**: Expenses that are not related to the company's core operations and are not captured by the other below-the-line categories.

**Non-Operating Expenses - Depreciation & Amortization**: D&A embedded within non-operating expenses. Only populate if the source explicitly breaks this out. Most companies do not — will frequently be 0.

**Interest Expense/(Income)**: Net interest — interest expense on debt minus any interest income. Report net interest expense as positive, net interest income as negative.

**Other Income**: Non-operating income not captured elsewhere. Report as a positive value. This reduces Total Expense/(Income). Only classify items here if they are genuinely non-operating — do NOT reclassify items from the source document's operating section here simply because the label contains the word "income."

**Other Expenses**: Non-operating expenses not captured elsewhere. Report as a positive value.

**Total Expense/(Income)**: D&A + Loss/(Gain) + Non-Operating Expenses + Non-Operating D&A + Interest Expense/(Income) - Other Income + Other Expenses. This aggregates all below-the-line items.

### Pre-Tax and Net Income

**Income (Loss) Before Taxes**: Net Operating Income - Total Expense/(Income).

**Taxes**: Income tax expense (current + deferred). Report as positive.

**Net Income (Loss)**: Income Before Taxes - Taxes.

### EBITDA

**EBIT**: Earnings before interest and taxes. EBIT = Income Before Taxes + Interest Expense/(Income). Equivalently: Net Income + Taxes + Interest Expense/(Income). Verify using both methods.

**EBITDA - Standard**: EBIT + ALL depreciation & amortization from all three locations in the income statement (COGS - D&A + D&A + Non-Operating Expenses - D&A). This is the firm's calculated EBITDA using a standardized methodology.

**EBITDA Adjustments**: Analyst-determined adjustments. Do NOT populate unless the source document explicitly provides EBITDA adjustments. Leave at 0 for analyst review.

**Adjusted EBITDA - Standard**: EBITDA - Standard + EBITDA Adjustments. Only calculable if EBITDA Adjustments is populated. Otherwise leave at 0.

**EBITDA - Reported**: The company's self-reported EBITDA as stated in the source document. Only populate if the source explicitly provides this figure. Do NOT calculate it — take it directly from the source. If the source provides an EBITDA figure, populate it here regardless of whether it matches EBITDA - Standard.

**Adjusted EBITDA - Reported**: The company's self-reported adjusted EBITDA. Only populate if the source explicitly provides this. Do NOT calculate.

**Covenant EBITDA**: EBITDA as defined in the credit agreement. Only populate if the source explicitly provides this. Do NOT calculate.

### Margins

All margin percentages are calculated as the relevant EBITDA measure ÷ Total Revenue × 100. Only populate a margin if the corresponding EBITDA measure is populated.

**EBITDA - Standard Margin %**: EBITDA - Standard ÷ Total Revenue × 100.

**Adjusted EBITDA - Standard Margin %**: Adjusted EBITDA - Standard ÷ Total Revenue × 100.

**Adjusted EBITDA - Reported Margin %**: Adjusted EBITDA - Reported ÷ Total Revenue × 100.

**Covenant EBITDA Margin %**: Covenant EBITDA ÷ Total Revenue × 100.

## Handling Uncertainty

If a line item from the Layer 1 extraction cannot be confidently classified (i.e., the correct template category is ambiguous given the item's label and the context of the financial statements), do NOT guess. Instead, assign the value to the most likely template field and append `"__FLAGGED"` to the field name in the output JSON. For example: `"Other Operating Expenses__FLAGGED": 50000`. This signals the item requires human review.

## Vertical Accounting Checks

After populating all line items, verify the following relationships. If any check fails, include a `"VALIDATION"` key in the output JSON listing each failed check with the expected vs. actual values.

### Revenue
1. **Total Revenue** = Net Revenue (in most cases)

### Gross Profit
2. **Gross Profit** = Total Revenue - COGS - COGS Depreciation & Amortization
3. **Gross Profit Margin %** = Gross Profit ÷ Total Revenue × 100

### Operating Expenses
4. **Total Operating Expenses** = Sales & Marketing + Administrative + Compensation & Benefits + R&D + Rent + Management Fee + Other Operating Expenses

### Net Operating Income
5. **Net Operating Income** = Gross Profit - Total Operating Expenses

### Below the Line
6. **Total Expense/(Income)** = D&A + Loss/(Gain) + Non-Operating Expenses + Non-Operating D&A + Interest Expense/(Income) - Other Income + Other Expenses

### Pre-Tax and Net Income
7. **Income (Loss) Before Taxes** = Net Operating Income - Total Expense/(Income)
8. **Net Income (Loss)** = Income Before Taxes - Taxes

### EBITDA
9. **EBIT** = Income Before Taxes + Interest Expense/(Income)
10. **EBIT (cross-check)** = Net Income + Taxes + Interest Expense/(Income)
11. **EBITDA - Standard** = EBIT + COGS D&A + D&A + Non-Operating D&A
12. **Adjusted EBITDA - Standard** = EBITDA - Standard + EBITDA Adjustments (only if Adjustments populated)

### Margins
13. **Gross Profit Margin %** = Gross Profit ÷ Total Revenue × 100
14. **EBITDA - Standard Margin %** = EBITDA - Standard ÷ Total Revenue × 100
15. **Adjusted EBITDA - Standard Margin %** = Adjusted EBITDA - Standard ÷ Total Revenue × 100
16. **Adjusted EBITDA - Reported Margin %** = Adjusted EBITDA - Reported ÷ Total Revenue × 100
17. **Covenant EBITDA Margin %** = Covenant EBITDA ÷ Total Revenue × 100

### Cross-Verification
18. If both a dollar amount and a margin % are reported or computed for the same measure, verify they are consistent. Flag any discrepancy.
19. If a computed value differs from the source document's reported value for the same line item, flag the discrepancy with both values noted.

## Output Format

Return a single JSON object with the following top-level keys:

1. **Statement data**: The populated template structure shown above (REVENUE, COST OF GOODS SOLD, etc.) with dollar values.
2. **`"REASONING"`**: A dictionary mapping each populated field name to its reasoning trace string.
3. **`"VALIDATION"`**: A dictionary mapping each validation check to its result (PASS/FAIL with details). Include all checks, not just failures.
