# Layer 1: Structured Extractor (Step D)

You are given a CSV of financial statement rows with formatting metadata extracted from an Excel sheet. Your task is to classify each row and produce a nested template structure.

## Input

**Statement type:** {statement_type}

**Reporting period:** {reporting_period}

**Rows CSV (columns: row_index, label, value, bold, italic, indent):**
```
{rows_csv}
```

## Row Types

There are exactly **four** row categories in source Excel sheets, but you will only **emit three** in your output:

| Source category | Emit? | Description |
|---|---|---|
| `individual` | ✅ | A single line item that rolls up into a parent sum. No children. |
| `sum` | ✅ | A subtotal or total. Bold or computationally derived. May have children. |
| `margin` | ✅ | A percentage/ratio row. Label contains `%`, `Margin`, or `% of`, OR cell is italic. |
| `title` | ❌ DROP | A section header with no value. Used only to infer grouping — never emitted. |

## Nesting Rules

- **Sum nodes are parents.** If a sum row immediately follows a group of individual rows that feed into it, those individuals are its `children[]`.
- **Title rows are dropped** — but the group of rows under a title belongs to the next sum above them. Use title rows to understand grouping, then discard them.
- **Margin rows** attach to the sum they are derived from. Place margins inside the `children[]` of their parent sum, after all individual children, OR as standalone rows if they span multiple sums.
- **Cross-section sums** (e.g., EBITDA = Gross Profit − SG&A) have no children in the tree. Use `computed_as` to record the formula as `"row_id OP row_id"` (e.g., `"10 - 20"`).
- **Indent level** is a strong signal: higher indent = child. Bold = likely a sum.
- Assign each row a unique integer `id` starting from 10, incrementing by 1.

## Arithmetic Verification

For every `sum` and `margin` node:
- Verify the value matches expectations (children summing to parent, margin = numerator/denominator × 100).
- Set `"validated": true` if the arithmetic checks out, `"validated": false` if not.
- Add a `"validation_note"` string explaining any discrepancy.

## Waterfall (Income Statement only)

If `statement_type` is `income_statement`, produce a top-level `waterfall` array. This is an ordered list of **major P&L milestone sums only** — not individuals, margins, or sub-totals. Each entry has:
- `row_id`: the id of the sum row
- `label`: the label
- `operator`: `null` (first row), `"+"`, `"-"`, or `"="`

**Which sums belong in the waterfall:**
- ONLY include sums that represent a major P&L milestone: top-line revenue, COGS/cost of sales, gross profit, operating expenses, EBITDA, net income, etc.
- DO NOT include sub-totals within a section (e.g. "Total Gross Sales", "Total Product Revenue") — these are components *within* the revenue section, not milestones in the P&L chain.
- A sum belongs in the waterfall only if it is a direct input or output of a cross-section equation (e.g. Gross Profit = Revenue − COGS). If a sum is purely a total of its own children and does not subtract from or add to any other waterfall item, leave it out.
- **Exclude LTM and TTM rows from the waterfall.**

The waterfall represents the shortest chain that explains the IS: e.g. Net Revenue − COGS = Gross Profit − SG&A − D&A = EBITDA − Interest = EBT − Taxes = Net Income.

For non-IS statements, omit the `waterfall` key entirely.

## Validation Flags

Produce a top-level `validation_flags` array of objects `{"row_id": N, "issue": "..."}` for any rows where:
- The sum value does not match the sum of its children
- A margin value seems implausible (outside −200% to +200%)
- A cross-section formula seems inconsistent

## Output Format

Return a single JSON object — no markdown fences, no explanation:

```json
{
  "rows": [
    {
      "id": 10,
      "type": "sum",
      "label": "Net Revenue",
      "value": 5000000,
      "bold": true,
      "italic": false,
      "indent": 0,
      "validated": true,
      "children": [
        {
          "id": 11,
          "type": "individual",
          "label": "Product Revenue",
          "value": 3000000,
          "bold": false,
          "italic": false,
          "indent": 1,
          "children": []
        },
        {
          "id": 12,
          "type": "individual",
          "label": "Service Revenue",
          "value": 2000000,
          "bold": false,
          "italic": false,
          "indent": 1,
          "children": []
        }
      ]
    },
    {
      "id": 20,
      "type": "sum",
      "label": "Gross Profit",
      "value": 2000000,
      "bold": true,
      "italic": false,
      "indent": 0,
      "computed_as": "10 - 15",
      "validated": true,
      "children": []
    },
    {
      "id": 21,
      "type": "margin",
      "label": "Gross Margin %",
      "value": 40.0,
      "bold": false,
      "italic": true,
      "indent": 0,
      "derived_from": [20, 10],
      "validated": true,
      "children": []
    }
  ],
  "waterfall": [
    {"row_id": 10, "label": "Net Revenue", "operator": null},
    {"row_id": 15, "label": "COGS", "operator": "-"},
    {"row_id": 20, "label": "Gross Profit", "operator": "="}
  ],
  "validation_flags": []
}
```

All monetary values in the `rows` are already normalised to actual dollars by the Python extractor — do not rescale them.
