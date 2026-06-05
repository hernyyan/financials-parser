# Layer 1: Structured Extractor (Step D)

You are given a CSV of financial statement rows with formatting metadata. Classify each row and produce a nested template.

## Input

**Statement type:** {statement_type}

**Reporting period:** {reporting_period}

**Rows CSV (columns: row_index, label, value, bold, italic, indent):**
```
{rows_csv}
```

## Label Rule — Non-Negotiable

Every node you emit must have a `label` that is a **character-for-character copy** of the `label` column from the corresponding CSV row.

- Do NOT substitute a section header's text for a sum row's text.
- Do NOT shorten, abbreviate, expand, or paraphrase.
- If the CSV row says `"Warehouse Fulfillment"`, write `"Warehouse Fulfillment"` — not `"Fulfillment"`.
- If one row says `"Revenue"` (value: 0) and another says `"Total Revenue"` (value: 150000), the sum node that represents the total uses `"Total Revenue"` — not `"Revenue"`.

To enforce this: for every node in your output, look up its `row_index` in the CSV and confirm the label matches exactly before emitting.

## Row Types

Only two types exist in your output:

| Type | Description |
|---|---|
| `individual` | A line item that rolls up into a parent sum. No children. |
| `sum` | A subtotal or total. May have children. |

**Skip entirely:**
- Rows whose label contains `%`, `Margin`, or `% of`, or that are purely italic with no bold — these are ratio/margin rows.
- Any row that is clearly a section header (bold=false, indent=0 or 1, value=0) with no role as an actual subtotal.

## Ordering Rule — Non-Negotiable

The top-level `rows` array in your output must be in the same order as the rows appear in the CSV, sorted ascending by `row_index`. Do not reorder rows. The only structural change you may make is nesting: a row may become a `children` entry of its parent sum row, but the sequence of rows as they appear in the document must be preserved.

## Nesting Rules

- A `sum` node's children are the individual rows that feed directly into that sum (same section, one indent level deeper).
- The sum row in the source always comes **after** its children (at the bottom of the group). Do not confuse a section header at the top of a group with the sum at the bottom.
- **Spatial containment — Non-Negotiable:** A child row's `row_index` must fall between the `row_index` of the first row in its section and the `row_index` of its parent sum row. Never assign a row as a child if it appears in a different section of the document. If "USBid" appears at row 9 (under Orders) and also at row 15 (under Revenue), these are two distinct rows — use the one whose `row_index` is spatially within the parent sum's section.
- **Cross-section sums** (e.g., EBITDA = Gross Profit − SG&A) have no children. Use `computed_as: "row_id OP row_id"`.
- Indent level is the primary grouping signal. Bold indicates a sum.
- Assign each emitted row a unique integer `id` starting from 10, incrementing by 1.

## Arithmetic Verification

For every `sum` node, check whether value ≈ sum of children (or cross-section formula). Set `validated: true/false` and a `validation_note` if false.

## Waterfall (Income Statement only)

If `statement_type` is `income_statement`, produce a `waterfall` array of **major P&L milestones only**:
- Top-line revenue, COGS, gross profit, operating expenses, EBITDA, net income.
- **Exclude** sub-totals within a section (e.g. "Total Gross Sales" that don't feed into another waterfall step).
- **Exclude** LTM and TTM rows.
- Each entry: `{ row_id, label (verbatim from that row), operator: null | "+" | "-" | "=" }`. First entry uses `null`.

Omit `waterfall` for non-IS statements.

## Output Format

Return a single JSON object, no markdown fences:

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
        { "id": 11, "type": "individual", "label": "Product Revenue", "value": 3000000, "bold": false, "italic": false, "indent": 1, "children": [] },
        { "id": 12, "type": "individual", "label": "Service Revenue", "value": 2000000, "bold": false, "italic": false, "indent": 1, "children": [] }
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
    }
  ],
  "waterfall": [
    { "row_id": 10, "label": "Net Revenue", "operator": null },
    { "row_id": 15, "label": "COGS", "operator": "-" },
    { "row_id": 20, "label": "Gross Profit", "operator": "=" }
  ],
  "validation_flags": []
}
```

Values are already in actual dollars — do not rescale.
