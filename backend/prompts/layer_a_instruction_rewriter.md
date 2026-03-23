You are converting a raw analyst correction into a clear, actionable classification instruction that will be stored in a company-specific context file. This file is referenced by a financial statement classification system when processing this company's future financial packages.

## Input

You will receive the following fields from an analyst correction:

- **field_name**: The template field that was corrected (e.g., "Total Operating Expenses", "Long Term Loans")
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
- field_name: "Total Operating Expenses"
- layer2_value: 0
- layer2_reasoning: "Could not identify a consolidated operating expense figure. Individual items were classified but no total was computed."
- corrected_value: 1347000
- analyst_reasoning: "This company reports individual opex lines (SGA, Rent, Other) but no total. Sum all operating expense items below Gross Profit into Total Operating Expenses."

**Output:**
{
  "instruction": "This company reports individual operating expense lines (SGA, Rent, Other) without a total. Sum all operating expense items appearing between Gross Profit and any below-the-line items into Total Operating Expenses.",
  "referenced_fields": ["Total Operating Expenses"]
}

**Input:**
- field_name: "Current Maturities"
- layer2_value: 0
- layer2_reasoning: "Source line 'Current Portion of Long-Term Liabilities' classified as Other Current Liabilities as it's a mixed bucket."
- corrected_value: 325000
- analyst_reasoning: "For this company, 'Current Portion of Long-Term Liabilities' is entirely bank debt (term loan). Classify as Current Maturities, not Other Current Liabilities."

**Output:**
{
  "instruction": "This company's 'Current Portion of Long-Term Liabilities' line consists entirely of term loan current maturities. Classify it as Current Maturities, not Other Current Liabilities.",
  "referenced_fields": ["Current Maturities", "Other Current Liabilities"]
}

## Length Constraints

The instruction MUST be concise:
- Maximum 3 sentences per instruction
- Maximum 200 words total
- If the correction involves multiple related points, prioritize the most actionable classification guidance and drop background context
- Do NOT pad with qualifiers, caveats, or restated accounting theory — every word must earn its place

The referenced_fields array should contain only the directly relevant fields — typically 2-3 fields maximum.

## Important

- Do NOT include dollar amounts from the specific correction in the instruction. The instruction should be generalizable across reporting periods.
- Do NOT repeat generic accounting rules. The classification system already knows these. Only state what is specific to this company.
- If the analyst reasoning is vague or unclear, do your best to infer the actionable instruction. If you truly cannot, return: {"instruction": "UNCLEAR — analyst reasoning insufficient to generate instruction. Manual review needed.", "referenced_fields": ["{field_name}"]}
