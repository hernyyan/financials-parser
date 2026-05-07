# Layer 1 Redesign — Project Board
*Ralph Wiggum loop: pick the next unblocked task, implement, check it off, repeat.*
*Last reviewed: 2026-05-07*

---

## Design Decisions (locked)

- **4-step pipeline:** Step A (Python header extraction) → Step B (AI column ID) → Step C (Python full extraction with formatting metadata) → Step D (AI hierarchy classification)
- **All 3 statement types** get Layer 1 templates. User only reviews IS template (type + waterfall). BS/CFS are created silently on first upload, admin can edit.
- **Template structure:** Nested JSON tree. Sum nodes are parents — children live inside `children[]`. No title nodes stored. `sums_children_of` eliminated.
- **Waterfall formula** embedded inside the template JSON as a top-level `waterfall` array (ordered sum-level boxes with operators). IS only.
- **Margin signals:** label contains `%`, `Margin`, `% of`; italic formatting; indent level. Value-range heuristic NOT used.
- **LTM/TTM fields** included in Layer 1 templates but excluded from IS waterfall. LTM Adj EBITDA section left empty in Layer 2 output pending iLevel integration.
- **Template save timing:** Template (structure only) saved when user completes template review. Values (structured JSON + period values) saved at Finalize.
- **No template versioning.** New line items added → null in historical periods.
- **No sheet assignment persistence.** User picks sheet each upload.
- **One sheet per statement type.** ✅ Done (Phase 0).
- **Company context** in Postgres `companies.context` column. ✅ Done (Phase 0).
- **`reviews.layer1_data`** stores full structured JSON at Finalize.
- **Layer 2** currently unchanged — still receives flat `lineItems`. Future redesign separate spec.
- **IS-only extraction change** — BS/CFS still get Layer 1 templates but the 4-step pipeline applies to all statements equally.

---

## Database Schema Changes

### `layer1_templates` table
```sql
-- SQLite
CREATE TABLE IF NOT EXISTS layer1_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    statement_type TEXT NOT NULL,
    template JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id),
    UNIQUE(company_id, statement_type)
);
-- Postgres
CREATE TABLE IF NOT EXISTS layer1_templates (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL,
    statement_type TEXT NOT NULL,
    template JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (company_id) REFERENCES companies(id),
    UNIQUE(company_id, statement_type)
);
```

### Template JSON structure
```json
{
  "meta": { "statement_type": "income_statement", "created_at": "..." },
  "rows": [
    {
      "id": 10, "type": "sum", "label": "Net Revenue",
      "children": [
        { "id": 11, "type": "individual", "label": "Amazon", "children": [] }
      ]
    },
    { "id": 20, "type": "sum", "label": "Gross Profit", "computed_as": "10 - 15", "children": [],
      "validated": true },
    { "id": 51, "type": "margin", "label": "Gross Margin", "derived_from": [20, 10], "children": [] }
  ],
  "waterfall": [
    { "row_id": 10, "label": "Net Revenue", "operator": null },
    { "row_id": 15, "label": "COGS", "operator": "-" },
    { "row_id": 20, "label": "Gross Profit", "operator": "=" }
  ]
}
```

---

## Task Board

### ✅ Completed
- [x] Delete `statement_tab_config` route + DDL + frontend functions
- [x] Delete `fuzzyMatch.ts`
- [x] Simplify Step1Upload to single-sheet radio selection
- [x] Remove `fieldTabAssignments` from WizardState everywhere
- [x] Remove Tab Config tab from admin CompanyDetail
- [x] Migrate `companies` schema: `context TEXT` replaces `markdown_filename`
- [x] Update all backend services/routes to use `companies.context`
- [x] Run migration script — 64 companies migrated to DB
- [x] Add `company_context/` + `company_datasets/` to `.gitignore`
- [x] Create this PRD as master tracking doc

---

### 🔲 DB: Add `layer1_templates` table
**Unblocked.** No dependencies.
- Add DDL (SQLite + Postgres) to `backend/app/db/database.py`
- Add `conn.execute` in `init_db()`
- Add `Layer1TemplateResponse` schema to `schemas.py`

---

### 🔲 Python extractor: `layer1_extractor.py`
**Unblocked.** No dependencies.
- Create `backend/app/services/layer1_extractor.py`
- `extract_header_rows(filepath, sheet_name, n_rows=12) -> str`
- `extract_rows_with_metadata(filepath, sheet_name, column_index, source_scaling, skip_rows) -> List[Dict]`
- `rows_to_csv_with_metadata(rows) -> str`
- Margin detection: label text (`%`, `Margin`, `% of`) + italic flag. No value-range heuristic.

---

### 🔲 AI prompts: column identifier + structured extractor
**Unblocked.** No dependencies.
- Create `backend/prompts/layer1_column_identifier.md`
  - Returns: `column_index`, `column_letter`, `source_scaling`, `skip_rows`, `period_matched`
- Create `backend/prompts/layer1_structured_extractor.md`
  - Four row types: `individual`, `sum`, `margin` (title rows detected for grouping but NOT emitted)
  - Sum-as-parent output: sum nodes contain `children[]`. Title rows dropped.
  - Margins: label text signals + italic. No value range.
  - Cross-section sums: `computed_as: "row_id OP row_id"`
  - Arithmetic verification: `validated: true/false` on every sum/margin
  - Waterfall (IS only): top-level `waterfall[]` array, sum-level nodes with operators, exclude LTM/TTM
  - Output: nested `rows[]` + `waterfall[]` + `validation_flags[]`

---

### 🔲 Layer 1 service: 4-step pipeline + template check
**Blocked by:** Python extractor, AI prompts
- Rewrite `backend/app/services/layer1_service.py` `run_extraction()`:
  - Step A: `extract_header_rows()`
  - Step B: AI column ID via `layer1_column_identifier`
  - Step C: `extract_rows_with_metadata()` + `rows_to_csv_with_metadata()`
  - Step D: AI hierarchy classification via `layer1_structured_extractor`
  - Build flat `lineItems` from `individual` + `sum` nodes (backward compat for Layer 2)
  - Return: `{ lineItems, structured, sourceScaling, columnIdentified }`
- Add `check_template(company_id, statement_type, structured_rows, db) -> TemplateCheckResult`:
  - Load stored template from `layer1_templates`
  - Fuzzy-match each row label (very high threshold; auto-assign caps/spacing diffs)
  - Returns: `{ has_template: bool, matched: [...], unmatched: [...] }`
- Add `save_template(company_id, statement_type, template_json, db)` — upserts `layer1_templates`

---

### 🔲 Layer 1 route: wire filepath + return structured output
**Blocked by:** Layer 1 service
- Update `backend/app/routes/layer1.py`:
  - Glob for `.xlsx`/`.xls` in session uploads dir, pass filepath to service
  - After extraction, call `check_template()` for each statement type
  - Return `templateCheck` in response: `{ has_template, unmatched_items }`
- Update `Layer1Response` in `schemas.py`:
  ```python
  structured: Optional[Dict] = None
  templateCheck: Optional[Dict] = None
  ```
- Update Finalize route to store full `structured` JSON in `reviews.layer1_data`

---

### 🔲 Layer 1 template API routes
**Blocked by:** DB table
- Create `backend/app/routes/layer1_templates.py`:
  - `GET /companies/{id}/layer1-templates/{statement_type}` — returns stored template or 404
  - `POST /companies/{id}/layer1-templates/{statement_type}` — upserts template
- Register router in `backend/app/main.py`
- Add `getLayer1Template`, `saveLayer1Template` to `frontend/src/api/client.ts`

---

### 🔲 Frontend types: Layer 1 structured types
**Unblocked.**
- Add to `frontend/src/types/index.ts`:
  ```ts
  export interface Layer1TemplateRow {
    id: number
    type: 'individual' | 'sum' | 'margin'
    label: string
    value?: number | null        // present during review, not in stored template
    children: Layer1TemplateRow[]
    computed_as?: string
    derived_from?: number[]
    validated?: boolean
    validation_note?: string
  }
  export interface WaterfallStep {
    row_id: number
    label: string
    operator: null | '+' | '-' | '='
  }
  export interface Layer1Template {
    meta: { statement_type: string; created_at: string }
    rows: Layer1TemplateRow[]
    waterfall?: WaterfallStep[]
  }
  export interface TemplateCheckResult {
    has_template: boolean
    unmatched_items: Layer1TemplateRow[]
  }
  ```
- Add `structured?: Layer1Template` and `templateCheck?: TemplateCheckResult` to `Layer1Result` in `types/index.ts`

---

### 🔲 TemplateReview component (new template — first upload)
**Blocked by:** Layer 1 template API routes, Frontend types
- Create `frontend/src/components/wizard/TemplateReview.tsx`
- Tree renderer:
  - `sum` nodes: bold, left-aligned, type badge `SUM` (clickable)
  - `individual` nodes: indented ~16px, normal weight, badge `IND`
  - `margin` nodes: indented ~32px, italic, badge `MAR`
  - Values column showing extracted values for current period (display only)
- Badge click:
  - `SUM` → `IND`: clears children, removes from waterfall (with notification banner)
  - `IND` → `SUM`: dims screen, multi-select mode — user clicks child rows, confirm button
  - Any → `MAR`: flips type, no relationship changes needed
- Waterfall editor (IS only, below tree):
  - Ordered labeled boxes with `+`/`-`/`=` operators between them
  - Add/remove sum rows, reorder (up/down arrows), operator toggle
- "Save Template" button → POST to `/companies/{id}/layer1-templates/{statement_type}`

---

### 🔲 TemplateDeltaReview component (new line items on existing template)
**Blocked by:** TemplateReview component (shares tree renderer logic)
- Create `frontend/src/components/wizard/TemplateDeltaReview.tsx`
- Left panel: stored template tree (read-only)
- Right panel: unmatched items from new upload, each with:
  - "Map to existing" → click a target row in left panel
  - "Add as new" → type badge selector + parent assignment
- "Save Updates" → updates stored template, shows waterfall editor if new sums added

---

### 🔲 Step1Upload: integrate template review flow
**Blocked by:** TemplateReview, TemplateDeltaReview, Layer 1 route
- After extraction completes, check `templateCheck` in response:
  - `has_template: false` → show `TemplateReview` for IS; silently auto-save BS/CFS templates; block Step 2 until IS template saved
  - `has_template: true` + `unmatched_items: []` → proceed silently to Step 2
  - `has_template: true` + `unmatched_items` non-empty → show `TemplateDeltaReview`
- Add `layer1Template` to WizardState to pass structured data to review components

---

### 🔲 Admin portal: Layer 1 Templates tab on CompanyDetail
**Blocked by:** Layer 1 template API routes, Frontend types
- Add "Layer 1 Templates" tab to `frontend/src/components/admin/CompanyDetail.tsx`
- Sub-tabs: IS / BS / CFS
- Empty state if no template: "No template yet — will be created on first upload"
- Full editing: all type/relationship operations from TemplateReview + reparenting (drag child between sums)
- Waterfall editor for IS
- Save button per statement type

---

### 🔲 Layer 2 redesign spec
**Blocked by:** Layer 1 stable + tested
- Write separate spec doc once Layer 1 is producing consistent outputs
- Layer 2 will receive full structured JSON instead of flat lineItems
- Layer 1 waterfall provides context for reconciling company IS logic vs firm standard template

---

## Dependency Graph (for next-task selection)

```
DB table ──────────────────────────────────────────┐
Python extractor ────────────────────────────────┐ │
AI prompts ──────────────────────────────────────┤ │
                                                 ↓ ↓
                                          Layer 1 service
                                                 ↓
                                          Layer 1 route
                                                 ↓
Frontend types (partial — unblocked now) ────────┤
                                                 ↓
Layer 1 template API routes ─────────────────────┤
                                                 ↓
                               ┌─────────────────┴────────────────┐
                               ↓                                   ↓
                      TemplateReview                     Admin L1 Templates tab
                               ↓
                      TemplateDeltaReview
                               ↓
                      Step1Upload integration
                               ↓
                      Layer 2 redesign spec
```
