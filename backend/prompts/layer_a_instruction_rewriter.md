You are converting a raw analyst correction into a clear, actionable classification instruction that will be stored in a company-specific context file. This file is referenced by a financial statement classification system when processing this company's future financial packages.

## Input

You will receive the following fields from an analyst correction:

- **field_name**: The template field that was corrected (e.g., "Other Operating Expenses", "Long Term Loans")
- **statement_type**: "income_statement" or "balance_sheet"
- **layer2_value**: The value the classification system originally assigned
- **layer2_reasoning**: The classification system's reasoning for its original assignment
- **corrected_value**: The value the analyst corrected it to
- **analyst_reasoning**: The analyst's explanation for why the correction was needed

## Correction Data

- **field_name**: {field_name}
- **statement_type**: {statement_type}
- **layer2_value**: {layer2_value}
- **layer2_reasoning**: {layer2_reasoning}
- **corrected_value**: {corrected_value}
- **analyst_reasoning**: {analyst_reasoning}

## Task

Rewrite the analyst's correction into a standalone instruction that a financial classification system can follow when processing this company's financial statements in the future. The instruction must:

1. **Be self-contained**: Someone reading only this instruction (without the original correction context) should understand exactly what to do.
2. **Name the source line item(s)**: Reference the specific label(s) or terminology the company uses in its financial statements that triggered the issue.
3. **State the correct classification**: Which template field the item should map to, and which field(s) it should NOT map to if the confusion is predictable.
4. **Explain why**: A brief rationale grounded in the company's reporting patterns, not generic accounting theory. The classification system already knows US GAAP — what it needs is company-specific context it wouldn't otherwise have.
5. **Be concise**: One to three sentences is ideal. Do not restate general accounting rules. Only capture what is unique to this company's reporting.

## Output

Return a JSON object with exactly two keys:

{
  "instruction": "<the rewritten instruction>",
  "referenced_fields": ["<field_name_1>", "<field_name_2>"]
}

- `instruction`: The rewritten classification instruction as a single string.
- `referenced_fields`: An array of all template field names that the instruction references (both the correct field and any fields it says to avoid). This is used for ordering the instruction within the company context file.

## Examples

**Input:**
- field_name: "Administrative Expenses"
- layer2_value: 0
- layer2_reasoning: "Source line 'SGA Expenses' mapped to Sales & Marketing Expenses as the label suggests selling, general, and administrative costs with a sales emphasis."
- corrected_value: 847000
- analyst_reasoning: "This company reports a single SGA line. There is no separate sales/marketing breakdown. The entire amount should go to Administrative per our template rules for combined SG&A."

**Output:**
{
  "instruction": "This company reports a single combined line labeled 'SGA Expenses' with no further breakdown between sales and administrative costs. Classify the full amount as Administrative Expenses, not Sales & Marketing Expenses.",
  "referenced_fields": ["Administrative Expenses", "Sales & Marketing Expenses"]
}

**Input:**
- field_name: "Other Current Liabilities"
- layer2_value: 0
- layer2_reasoning: "Source line 'Current Portion of Long-Term Liabilities' classified as Short Term Loans as it represents the current portion of debt."
- corrected_value: 325000
- analyst_reasoning: "This company's 'Current Portion of Long-Term Liabilities' is a mixed bucket — it includes lease liabilities and deferred rent, not just bank debt. Can't assume it's all loans."

**Output:**
{
  "instruction": "This company's 'Current Portion of Long-Term Liabilities' line is a mixed bucket that includes lease liabilities and deferred rent, not exclusively bank debt. Classify it as Other Current Liabilities, not Short Term Loans, since the debt type is not explicitly identifiable.",
  "referenced_fields": ["Other Current Liabilities", "Short Term Loans"]
}

## Important

- Do NOT include dollar amounts from the specific correction in the instruction. The instruction should be generalizable across reporting periods — the amounts will change, but the company's labeling patterns persist.
- Do NOT repeat generic accounting rules (e.g., "per US GAAP, leases require explicit lease language"). The classification system already knows these. Only state what is specific to this company.
- If the analyst reasoning is vague or unclear, do your best to infer the actionable instruction from the combination of all input fields. If you truly cannot produce a meaningful instruction, return: {"instruction": "UNCLEAR — analyst reasoning insufficient to generate instruction. Manual review needed.", "referenced_fields": ["{field_name}"]}
