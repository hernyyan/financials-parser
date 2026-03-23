# Layer 2: Income Statement Classification

You are given the extracted JSON output from Layer 1, containing all line items and their dollar values from a company's income statement. Your task is to classify each line item into the firm's standardized income statement template. The output must be a JSON object matching the exact structure below, with dollar values populated for each applicable line item. Many fields will be left as `null` — this is expected.

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

**Reasoning Integrity**: Every reasoning trace must be arithmetically verifiable. If the math doesn't add up, flag the discrepancy rather than fabricating a plausible-sounding explanation.

## Template Structure

```json
{
  "Total Revenue": null,
  "COGS": null,
  "Gross Profit": null,
  "Total Operating Expenses": null,
  "EBITDA - Standard": null,
  "EBITDA Adjustments": null,
  "Adjusted EBITDA - Standard": null,
  "Depreciation & Amortization": null,
  "Interest Expense/(Income)": null,
  "Other Expense / (Income)": null,
  "Taxes": null,
  "Net Income (Loss)": null,
  "LTM - Adj EBITDA items": null,
  "Equity Cure": null,
  "Adjusted EBITDA - Including Cures": null,
  "Covenant EBITDA": null
}
```

All fields default to `null`. Only populate a field if the source data supports it. `null` means unmapped/not reported. `0` means the source explicitly reported zero.

## Classification Rules

### Total Revenue

The primary revenue figure. In most cases this is Net Revenue (after returns, discounts, allowances). If the source reports both Gross Revenue and Net Revenue, use Net Revenue. If only a single revenue line is reported, use it as Total Revenue.

### COGS

Direct costs attributable to the production of goods or delivery of services sold. Includes materials, direct labor, and manufacturing overhead. If the source includes depreciation within COGS, include it in the COGS figure — do not attempt to separate it.

### Gross Profit

**Computed:** Total Revenue − COGS. If the source reports Gross Profit directly, verify it matches the computation. If it doesn't, populate both the computed value and flag the discrepancy.

### Total Operating Expenses

The sum of ALL operating expenses below Gross Profit. This is a single consolidated figure. It includes: sales & marketing, general & administrative, compensation & benefits, research & development, rent, management fees, and any other operating expenses the source reports. Do NOT attempt to break these into sub-categories — the template has a single Total Operating Expenses field.

If the source reports individual operating expense line items (e.g., "SGA Expenses: $500K", "Rent: $50K", "Other OpEx: $100K"), sum them all into Total Operating Expenses.

If the source reports Total Operating Expenses directly, use that figure. If it reports both individual items and a total, use the reported total and verify it matches the sum of the individual items. Flag any discrepancy.

### EBITDA - Standard

**Computed:** Gross Profit − Total Operating Expenses. This is the firm's standardized EBITDA calculation: earnings before interest, taxes, depreciation, amortization, and non-operating items. Verify against the source if the source reports its own EBITDA figure.

### EBITDA Adjustments

Only populate if the source document explicitly provides EBITDA adjustments. These are analyst-determined adjustments (add-backs, one-time items). Do NOT calculate or estimate. Leave as `null` unless the source explicitly reports them.

### Adjusted EBITDA - Standard

**Computed:** EBITDA - Standard + EBITDA Adjustments. Only populate if EBITDA Adjustments is populated. Otherwise leave as `null`.

### Depreciation & Amortization

Total depreciation and amortization expense. This includes D&A from all sources — whether reported in COGS, operating expenses, or as a separate line item. If D&A is embedded in COGS and also reported separately below, use only the separately reported figure to avoid double-counting. If the source only reports D&A embedded in COGS with no separate line, leave this field as `null` (it's already captured in COGS and reflected in EBITDA - Standard).

### Interest Expense/(Income)

Net interest — interest expense on debt minus any interest income. Report net interest expense as a positive value, net interest income as a negative value.

### Other Expense / (Income)

Consolidation of all non-operating items not captured by D&A, Interest, or Taxes. This includes: gains/losses on assets, debt, or FX; non-operating expenses; non-operating income; and any other below-the-line items. Report net expense as positive, net income as negative.

If the source reports multiple non-operating line items (e.g., "Loss on Disposal: $50K", "Other Income: -$20K"), net them into this single field.

**Respect source document placement**: If the source lists an item within its operating expenses section, classify it as part of Total Operating Expenses — do NOT reroute it here simply because the label contains "income," "gain," or "other."

### Taxes

Income tax expense (current + deferred). Report as a positive value.

### Net Income (Loss)

**Computed:** EBITDA - Standard − Depreciation & Amortization − Interest Expense/(Income) − Other Expense / (Income) − Taxes.

If the source reports Net Income directly, verify it matches this computation. If it doesn't match, populate the computed value and append `__FLAGGED` with the discrepancy noted in reasoning.

### LTM - Adj EBITDA items

Analyst-populated only. Leave as `null`. Do NOT attempt to calculate or estimate.

### Equity Cure

Analyst-populated only. Leave as `null`. Do NOT attempt to calculate or estimate.

### Adjusted EBITDA - Including Cures

Analyst-populated only. Leave as `null`. Do NOT attempt to calculate or estimate.

### Covenant EBITDA

Only populate if the source document explicitly provides Covenant EBITDA (EBITDA as defined in the credit agreement). Do NOT calculate. Take it directly from the source. If not explicitly reported, leave as `null`.

## Handling Uncertainty

If a line item from the Layer 1 extraction cannot be confidently classified, assign the value to the most likely template field and append `"__FLAGGED"` to the field name in the output JSON. This signals the item requires human review.

## Vertical Accounting Checks

After populating all fields, verify the following relationships. If any check fails, include a `"VALIDATION"` key in the output JSON listing each failed check with the expected vs. actual values. Allow ±$1 tolerance for rounding.

1. **Gross Profit** = Total Revenue − COGS
2. **EBITDA - Standard** = Gross Profit − Total Operating Expenses
3. **Adjusted EBITDA - Standard** = EBITDA - Standard + EBITDA Adjustments (only if Adjustments populated)
4. **Net Income (Loss)** = EBITDA - Standard − Depreciation & Amortization − Interest Expense/(Income) − Other Expense / (Income) − Taxes
5. **Cross-check**: If the source reports its own EBITDA, Adjusted EBITDA, or Net Income figure, compare it against the computed value. Flag any discrepancy with both values noted.

## Company-Specific Classification Rules

{company_context}

If the section above contains rules, they are specific to this company and were derived from analyst corrections on prior reporting periods. Apply these rules when relevant — they take precedence over the general classification rules above when they conflict on company-specific terminology, labeling patterns, or categorization decisions. They do NOT override basic arithmetic or validation checks.

If the section above is empty, ignore this section entirely.

## Output Format

Return a single JSON object with the following top-level keys:

1. **Statement data**: The populated template structure shown above with values (numbers or null).
2. **`"REASONING"`**: A dictionary mapping each populated field name to its reasoning trace string.
3. **`"VALIDATION"`**: A dictionary mapping each validation check to its result (PASS/FAIL with details). Include all checks, not just failures.
