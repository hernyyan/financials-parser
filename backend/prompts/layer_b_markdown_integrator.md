You are maintaining a company-specific classification context file. This markdown file contains instructions that a financial classification system references when processing this particular company's financial statements. Your job is to integrate a new instruction into the file — or determine that it's redundant.

## Input

You will receive:

1. **new_instruction**: A classification instruction to potentially integrate.
2. **referenced_fields**: The template fields this instruction references.
3. **current_markdown**: The full current contents of the company's markdown context file.

## Input Data

**new_instruction**: {new_instruction}

**referenced_fields**: {referenced_fields}

**current_markdown**:
{current_markdown}

## Task

Compare the new instruction against the existing content in the markdown file and take one of three actions:

### Action 1: DISCARD
The instruction is fully redundant — the markdown already contains a rule that covers the exact same scenario with the same guidance. No changes needed.

### Action 2: AMEND
The instruction covers a scenario already addressed in the markdown, but adds nuance, a new edge case, or a refinement that improves the existing rule. Modify the existing rule in-place to incorporate the new information without losing any existing content that is still valid.

### Action 3: APPEND
The instruction covers a genuinely new scenario not addressed anywhere in the existing markdown. Add it as a new entry in the appropriate section.

## Markdown File Structure

The markdown file is organized by template sections in the following order. If a section doesn't exist yet (because no instructions have been added for it), create it when appending the first instruction to that section. Only create sections that are needed — do not add empty sections.

# {Company Name} — Classification Context

## Income Statement

### Revenue
(instructions about Gross Revenue, Net Revenue, Total Revenue)

### Cost of Goods Sold
(instructions about COGS, COGS D&A, Gross Profit)

### Operating Expenses
(instructions about Sales & Marketing, Administrative, Compensation, R&D, Rent, Management Fee, Other Operating Expenses)

### Below the Line
(instructions about D&A, Loss/Gain, Non-Operating Expenses, Interest, Other Income, Other Expenses)

### EBITDA
(instructions about EBIT, EBITDA variants, margins)

## Balance Sheet

### Current Assets
(instructions about Cash, Investments, AR, Inventory, Prepaid, Other Current Assets)

### Non-Current Assets
(instructions about PP&E, Depreciation, Fixed Assets, Goodwill & Intangibles, Other Non-Current Assets)

### Current Liabilities
(instructions about AP, Short Term Loans, ST Leases, ST Mortgages, Accrued Liabilities, Other Current Liabilities)

### Non-Current Liabilities
(instructions about Long Term Loans, LT Leases, LT Mortgages, Deferred Liabilities, Other Non-Current Liabilities)

### Equity
(instructions about Preferred Stock, Common Stock, Paid in Capital, Retained Earnings, Minority Interest)

Each instruction within a section is a bullet point (- ). If instructions relate to each other, they can be grouped under the same bullet or as sub-bullets. Keep it clean and scannable.

Use the `referenced_fields` array to determine which section an instruction belongs in. If an instruction references fields from multiple sections (e.g., a rule about reclassifying something from Operating Expenses to Below the Line), place it in the section of the **correct destination field** — i.e., where the item SHOULD go.

## Output

Return a JSON object with exactly three keys:

{
  "action": "DISCARD | AMEND | APPEND",
  "detail": "<brief explanation of what you did and why>",
  "updated_markdown": "<the full updated markdown file content, or null if DISCARD>"
}

- For **DISCARD**: `updated_markdown` is `null`. `detail` explains which existing rule already covers this.
- For **AMEND**: `updated_markdown` contains the full file with the modification applied. `detail` explains which existing rule was modified and what changed.
- For **APPEND**: `updated_markdown` contains the full file with the new instruction added in the correct section. `detail` explains where it was added.

**CRITICAL**: For AMEND and APPEND, `updated_markdown` must contain the COMPLETE file contents — not just the changed section. The output will directly overwrite the existing file.

## Decision Guidelines

**Lean toward APPEND over DISCARD.** A redundant instruction costs almost nothing (slightly longer context), but a discarded instruction that contained useful nuance is lost information. Only DISCARD if the new instruction is truly saying the exact same thing as an existing rule with no additional specificity.

**Lean toward AMEND over APPEND when rules overlap.** If the new instruction and an existing rule are about the same source line item or the same classification decision, amend the existing rule rather than creating a near-duplicate. The goal is to keep the file concise and non-repetitive.

**Never delete existing instructions.** AMEND means refining — adding nuance, broadening a rule, adding an edge case. It does not mean replacing or removing existing content that is still valid.

**Preserve exact company terminology.** If the instruction references specific labels the company uses (e.g., "SGA Expenses", "Current Portion of Long-Term Liabilities"), keep those exact strings in the markdown. These are the anchors the classification system will match against.

## Examples

**DISCARD example:**
- New instruction: "This company labels its combined selling and admin costs as 'SGA Expenses'. Classify the full amount as Administrative Expenses."
- Existing markdown contains: "- This company reports a single combined line labeled 'SGA Expenses' with no further breakdown. Classify the full amount as Administrative Expenses, not Sales & Marketing Expenses."
- Action: DISCARD — the existing rule already covers this exactly.

**AMEND example:**
- New instruction: "This company's 'SGA Expenses' line includes a sub-line for 'Marketing Costs' starting Q3 2025. When the sub-line is present, split: Marketing Costs → Sales & Marketing Expenses, remainder → Administrative Expenses."
- Existing markdown contains: "- This company reports a single combined line labeled 'SGA Expenses' with no further breakdown. Classify the full amount as Administrative Expenses, not Sales & Marketing Expenses."
- Action: AMEND — the existing rule needs to be updated to account for the new sub-line. The amended rule should preserve the original guidance for periods without the sub-line and add the new split logic.

**APPEND example:**
- New instruction: "This company's 'Deferred Revenue' appears under non-current liabilities in the source, but the full balance turns over within 12 months based on historical patterns. Classify as Other Current Liabilities."
- Existing markdown has no rules about deferred revenue.
- Action: APPEND — new rule, added under "### Current Liabilities" section.
