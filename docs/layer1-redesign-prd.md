# Layer 1 Redesign PRD
*Central tracking document. Check off tasks as completed. Review before each new implementation sprint.*

---

## Design Decisions (locked)

- **4-step pipeline:** Step A (Python header extraction) → Step B (AI column ID) → Step C (Python full extraction with formatting metadata) → Step D (AI hierarchy classification)
- **All 3 statement types** get Layer 1 templates. User only reviews IS template. BS/CFS are created silently on first upload.
- **Template structure:** Nested JSON tree. Sum nodes are parents — children live inside `children[]`. No title nodes stored. `sums_children_of` eliminated.
- **Waterfall formula** embedded inside the template JSON as a top-level `waterfall` array (ordered sum-level boxes with operators). IS only — BS/CFS waterfall is universal and not stored.
- **Margin signals:** label contains `%`, `Margin`, `% of`; italic formatting; indent level. Value-range heuristic (`-5 to 5`) is NOT used.
- **LTM/TTM fields** are included in Layer 1 templates but excluded from the IS waterfall formula. Policy: leave LTM Adj EBITDA section empty in Layer 2 output until iLevel integration.
- **Template save timing:** Template (structure only, no values) saved when user completes template review screen. Values (full structured JSON with period values merged in) saved at Finalize.
- **No template versioning.** New line items added to a template have `null` value in all historical finalized periods.
- **No sheet assignment persistence.** User picks which sheet is IS/BS/CFS on each upload. No fuzzy matching of sheet names.
- **One sheet per statement type.** Multi-tab assignment is removed entirely.
- **Company context** migrated from disk markdown files to a `context TEXT` column on the `companies` Postgres table. `markdown_filename` column and `COMPANY_CONTEXT_DIR` config deleted.
- **`reviews.layer1_data`** stores full structured JSON (template structure + period values merged). Flat `lineItems` dict is produced at runtime for backward compat with Layer 2 but not stored separately.
- **Layer 2** currently unchanged — still receives flat `lineItems`. Future redesign (separate spec) will consume full structured JSON.

---

## Database Schema Changes

### New table: `layer1_templates`
```sql
-- SQLite
CREATE TABLE IF NOT EXISTS layer1_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    statement_type TEXT NOT NULL,  -- 'income_statement' | 'balance_sheet' | 'cash_flow_statement'
    template JSON NOT NULL,        -- nested tree JSON (rows + waterfall for IS)
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

### `companies` table changes
- Add `context TEXT` column
- Drop `markdown_filename TEXT` column (after migration)

### Tables to drop
- `is_tab_configs`
- `statement_tab_configs`

---

## Template JSON Structure

```json
{
  "meta": {
    "statement_type": "income_statement",
    "created_at": "2026-05-07T00:00:00Z"
  },
  "rows": [
    {
      "id": 10,
      "type": "sum",
      "label": "Net Revenue",
      "children": [
        { "id": 11, "type": "individual", "label": "Amazon", "children": [] },
        { "id": 12, "type": "individual", "label": "Direct", "children": [] }
      ]
    },
    {
      "id": 20,
      "type": "sum",
      "label": "Gross Profit",
      "computed_as": "10 - 15",
      "children": []
    },
    {
      "id": 51,
      "type": "margin",
      "label": "Gross Margin",
      "derived_from": [20, 10],
      "children": []
    }
  ],
  "waterfall": [
    { "row_id": 10, "label": "Net Revenue", "operator": null },
    { "row_id": 15, "label": "COGS", "operator": "-" },
    { "row_id": 20, "label": "Gross Profit", "operator": "=" },
    { "row_id": 71, "label": "Total OpEx", "operator": "-" },
    { "row_id": 80, "label": "EBITDA", "operator": "=" }
  ]
}
```

---

## Phases and Tasks

---

### Phase 0 — Cleanup Dead Code
*Remove everything related to multi-tab assignment and migrate company context to Postgres. This must be done first to avoid carrying forward dead patterns into new code.*

- [ ] **0.1** Delete `backend/app/routes/is_tab_config.py`
- [ ] **0.2** Delete `backend/app/routes/statement_tab_config.py`
- [ ] **0.3** Remove `is_tab_configs` and `statement_tab_configs` DDL and `init_db()` calls from `backend/app/db/database.py`
- [ ] **0.4** Remove router imports and `app.include_router()` calls for both tab config routers in `backend/app/main.py`
- [ ] **0.5** Remove `ISTabConfigRequest`, `ISTabConfigResponse` from `backend/app/models/schemas.py`
- [ ] **0.6** Remove `getISTabConfig`, `saveISTabConfig`, `getStatementTabConfigs`, `saveStatementTabConfig`, `StatementTabConfig` interface from `frontend/src/api/client.ts`
- [ ] **0.7** Delete `frontend/src/utils/fuzzyMatch.ts`
- [ ] **0.8** Remove all multi-tab assignment UI from `frontend/src/components/wizard/Step1Upload.tsx` (tab assignment dropdowns, `assignments` state, `fieldAssignments` state, the `loadSavedTabConfigs` calls, the save-on-extraction block)
- [ ] **0.9** Remove `fieldTabAssignments` from `WizardState` in `frontend/src/types/index.ts` and from `useWizardState.ts`
- [ ] **0.10** Remove IS Config / Tab Config tab from `frontend/src/components/admin/CompanyDetail.tsx`
- [ ] **0.11** **Company context migration:** Add `context TEXT` column to `companies` table. Write a migration script that reads each company's `.md` file from disk and writes the content into the new column. Update `correction_pipeline.py`, `layer2_service.py`, `admin_context.py`, `admin_companies.py`, `text_utils.py` to read/write `companies.context` instead of disk files. Remove `COMPANY_CONTEXT_DIR` from `config.py`. Drop `markdown_filename` column. Delete `backend/company_context/` directory.

---

### Phase 1 — DB Schema for Layer 1 Templates
*Add the new table. No other code changes yet.*

- [ ] **1.1** Add `layer1_templates` DDL (SQLite + Postgres) to `backend/app/db/database.py`
- [ ] **1.2** Add `conn.execute(text(create_layer1_templates))` in `init_db()`
- [ ] **1.3** Add `Layer1Template` schema to `backend/app/models/schemas.py`:
  ```python
  class Layer1TemplateResponse(BaseModel):
      company_id: int
      statement_type: str
      template: Dict
      updated_at: str
  ```

---

### Phase 2 — Python Extractor (`layer1_extractor.py`)
*Deterministic extraction with formatting metadata. No AI in this file.*

- [ ] **2.1** Create `backend/app/services/layer1_extractor.py` with:
  - `extract_header_rows(filepath, sheet_name, n_rows=12) -> str` — plain CSV of first N rows
  - `extract_rows_with_metadata(filepath, sheet_name, column_index, source_scaling, skip_rows) -> List[Dict]` — every row verbatim with bold/italic/indent/value
  - `rows_to_csv_with_metadata(rows) -> str` — CSV string for AI prompt
- [ ] **2.2** Fix margin signal: remove value-range heuristic from any existing code. Margin detection relies on label text and italic flag only.

---

### Phase 3 — AI Prompts
*Rewrite both prompts to match the new nested-tree output format.*

- [ ] **3.1** Create `backend/prompts/layer1_column_identifier.md` — identifies column index, scaling, skip_rows. Returns JSON with `column_index`, `column_letter`, `source_scaling`, `skip_rows`, `period_matched`.
- [ ] **3.2** Create `backend/prompts/layer1_structured_extractor.md` with:
  - Four row types: `title` (dropped post-classification), `individual`, `sum`, `margin`
  - **Sum-as-parent output:** sum nodes contain their children in `children[]`. No `sums_children_of` field.
  - **Title rows:** AI detects them for grouping purposes but does NOT emit them in output. The matching sum becomes the parent.
  - Margin signals: label text (`%`, `Margin`, `% of`) + italic. NOT value range.
  - Cross-section sums use `computed_as: "row_id OP row_id"`
  - Arithmetic verification: `validated: true/false` on every sum/margin
  - **Waterfall:** for IS only, produce a top-level `waterfall` array of sum-level nodes with operators. Exclude LTM/TTM items.
  - Output: nested `rows[]` tree + `waterfall[]` + `validation_flags[]`

---

### Phase 4 — Layer 1 Service & Route
*Wire up the 4-step pipeline. Add template check/create/update logic.*

- [ ] **4.1** Update `backend/app/services/layer1_service.py` `run_extraction()`:
  - Step A: `extract_header_rows()`
  - Step B: AI column identification via `layer1_column_identifier` prompt
  - Step C: `extract_rows_with_metadata()` + `rows_to_csv_with_metadata()`
  - Step D: AI hierarchy classification via `layer1_structured_extractor` prompt
  - Produce flat `lineItems` dict from `individual` + `sum` nodes (backward compat for Layer 2)
  - Return: `{ lineItems, structured, sourceScaling, columnIdentified }`
- [ ] **4.2** Add `check_template(company_id, statement_type, structured_rows) -> TemplateCheckResult` method:
  - Loads stored template from `layer1_templates` for this company + statement type
  - Fuzzy-matches each row label in `structured_rows` against stored template (very high threshold; auto-assign capitalization/spacing differences)
  - Returns: `{ has_template: bool, matched: [...], unmatched: [...] }` where `unmatched` are rows in the new upload not found in stored template
- [ ] **4.3** Add `save_template(company_id, statement_type, template_json)` method — upserts `layer1_templates`
- [ ] **4.4** Update `backend/app/routes/layer1.py`:
  - Pass Excel filepath to service (glob for `.xlsx`/`.xls` in session uploads dir)
  - After extraction, call `check_template()` for each statement type processed
  - Return `template_check` in response: `{ has_template, unmatched_items }`
- [ ] **4.5** Update `Layer1Response` schema in `schemas.py`:
  ```python
  class Layer1Response(BaseModel):
      sheetName: str
      lineItems: Dict[str, float]
      structured: Optional[Dict] = None
      sourceScaling: str
      columnIdentified: str
      templateCheck: Optional[Dict] = None  # { has_template, unmatched_items }
  ```
- [ ] **4.6** Update `reviews` table write at Finalize to store full `structured` JSON (not just flat `lineItems`)

---

### Phase 5 — Template Creation UI (Step 1b, first upload)
*Surfaces between Step 1 and Step 2 when no template exists. IS review is user-facing; BS/CFS are auto-saved silently.*

- [ ] **5.1** Create `frontend/src/components/wizard/TemplateReview.tsx`:
  - Tree renderer: `sum` nodes bold, left-aligned; `individual` nodes indented; `margin` nodes most-indented, italic
  - Right-side badge per row showing type (`SUM` / `IND` / `MAR`) — clickable
  - Clicking badge cycles type. Flipping to `sum` dims screen + multi-select mode for children. Flipping away from `sum` clears children.
  - Auto-remove from waterfall when a row is reclassified away from `sum`, with notification banner
  - Values column showing extracted values for the current period (display only, not editable)
  - Waterfall editor at bottom (IS only): ordered boxes with operators, add/remove/reorder, operator toggle
  - "Save Template" button → POST to `/companies/{id}/layer1-templates/{statement_type}`
- [ ] **5.2** Add template creation API routes in `backend/app/routes/layer1_templates.py`:
  - `GET /companies/{company_id}/layer1-templates/{statement_type}` — returns stored template or 404
  - `POST /companies/{company_id}/layer1-templates/{statement_type}` — upserts template
- [ ] **5.3** Register new router in `backend/app/main.py`
- [ ] **5.4** Add API client functions in `frontend/src/api/client.ts`: `getLayer1Template`, `saveLayer1Template`
- [ ] **5.5** Update `frontend/src/components/wizard/Step1Upload.tsx`:
  - After extraction completes, check `templateCheck` in response
  - If `has_template: false`: show `TemplateReview` for IS. Auto-save BS/CFS templates silently (no user interaction). Block progression to Step 2 until IS template saved.
  - If `has_template: true` and `unmatched_items: []`: proceed silently to Step 2
  - If `has_template: true` and `unmatched_items` non-empty: show delta review (Phase 6)

---

### Phase 6 — Delta Review UI (returning upload, new line items detected)
*Side-by-side view. Left = stored template. Right = new unmatched items.*

- [ ] **6.1** Create `frontend/src/components/wizard/TemplateDeltaReview.tsx`:
  - Left panel: stored template tree (read-only)
  - Right panel: unmatched items from new upload, each with two actions:
    - "Map to existing" — click to select a target row from the left panel. Assigns the new label as an alias; the stored entry is used going forward.
    - "Add as new" — type badge selector + parent assignment (if `individual` or `sum`)
  - Once all unmatched items are resolved, "Save Updates" button → updates stored template
  - Waterfall editor shown if any new `sum` items were added

---

### Phase 7 — Admin Portal: Layer 1 Templates Tab
*New tab on CompanyDetail page. Admins can view and edit all 3 statement type templates.*

- [ ] **7.1** Add "Layer 1 Templates" tab to `frontend/src/components/admin/CompanyDetail.tsx`
- [ ] **7.2** Sub-tabs: IS / BS / CFS
- [ ] **7.3** Empty state if no template: "No template yet — will be created on first upload"
- [ ] **7.4** Template tree display with full editing capability (all operations from Phase 5 + reparenting — drag child from one sum to another)
- [ ] **7.5** Waterfall editor for IS template
- [ ] **7.6** Save button per statement type

---

### Phase 8 — Layer 2 Structured JSON Consumption *(separate spec, after Layer 1 stable)*
*Layer 2 currently unchanged. Future work: rewrite Layer 2 prompt to accept full structured JSON instead of flat lineItems. Layer 1 waterfall provides context for reconciling company-specific IS logic against firm's standard template.*

- [ ] **8.1** Write Layer 2 redesign spec (separate document)

---

## Files Affected Summary

| File | Action |
|------|--------|
| `backend/app/db/database.py` | Add `layer1_templates` DDL; remove `is_tab_configs` + `statement_tab_configs` DDL; add `context` column migration |
| `backend/app/models/schemas.py` | Add `Layer1TemplateResponse`; add `structured`/`templateCheck` to `Layer1Response`; remove `ISTabConfigRequest/Response` |
| `backend/app/routes/is_tab_config.py` | **Delete** |
| `backend/app/routes/statement_tab_config.py` | **Delete** |
| `backend/app/routes/layer1_templates.py` | **Create** |
| `backend/app/routes/layer1.py` | Pass filepath; return structured + templateCheck |
| `backend/app/main.py` | Remove tab config routers; add layer1_templates router |
| `backend/app/services/layer1_extractor.py` | **Create** |
| `backend/app/services/layer1_service.py` | New 4-step `run_extraction()`; add `check_template()`, `save_template()` |
| `backend/app/services/correction_pipeline.py` | Read context from DB instead of disk |
| `backend/app/services/layer2_service.py` | Read context from DB instead of disk |
| `backend/app/services/company_context_service.py` | Read/write context from DB |
| `backend/app/routes/admin_context.py` | Read/write context from DB |
| `backend/app/routes/admin_companies.py` | Remove markdown_filename references |
| `backend/app/utils/text_utils.py` | Accept text string instead of file path |
| `backend/app/config.py` | Remove `COMPANY_CONTEXT_DIR` |
| `backend/prompts/layer1_column_identifier.md` | **Create** |
| `backend/prompts/layer1_structured_extractor.md` | **Create** |
| `backend/company_context/` | **Delete directory** (after migration) |
| `frontend/src/api/client.ts` | Remove tab config functions; add `getLayer1Template`, `saveLayer1Template` |
| `frontend/src/utils/fuzzyMatch.ts` | **Delete** |
| `frontend/src/types/index.ts` | Remove `fieldTabAssignments` from `WizardState` |
| `frontend/src/hooks/useWizardState.ts` | Remove tab config state |
| `frontend/src/components/wizard/Step1Upload.tsx` | Remove multi-tab UI; add template check routing |
| `frontend/src/components/wizard/TemplateReview.tsx` | **Create** |
| `frontend/src/components/wizard/TemplateDeltaReview.tsx` | **Create** |
| `frontend/src/components/admin/CompanyDetail.tsx` | Remove IS Config tab; add Layer 1 Templates tab |
