# Layer 2 Redesign Spec
*Status: Draft — awaiting Layer 1 stable in production*
*Last reviewed: 2026-05-07*

---

## Context

Layer 1 now produces a **nested structured JSON** for each statement (rows tree + waterfall). Layer 2 currently receives only the flat `lineItems` dict. The redesign makes Layer 2 aware of the hierarchical structure so it can:

1. Use parent-child relationships for more accurate classification
2. Understand the IS waterfall for P&L reconciliation
3. Stop having to infer structure from field names alone

---

## Current State

```
Layer 1 → { lineItems: {label: float}, sourceScaling, columnIdentified }
Layer 2 ← flat lineItems dict
Layer 2 → {statementType, values, reasoning, validation, flaggedFields, ...}
```

---

## Target State

```
Layer 1 → { lineItems, structured: {rows, waterfall?, validation_flags}, sourceScaling, columnIdentified }
Layer 2 ← structured JSON (full tree) + lineItems (flat, for backward compat)
Layer 2 → same output shape (no breaking change for Step 2/3 UI)
```

---

## Design Decisions

### What Layer 2 receives

The Layer 2 prompt will receive **both**:
- `structured_json`: the full Layer 1 tree (rows + waterfall if IS)
- `line_items`: the existing flat dict (unchanged — keeps backward compat)

The structured JSON gives Claude context about what feeds into what. The flat dict stays for the existing field-matching logic.

### Prompt changes

Each Layer 2 prompt (`layer2_income_statement.md`, `layer2_balance_sheet.md`, `layer2_cash_flow_statement.md`) gets a new `{structured_json}` variable injected before the `{layer1_output}` block.

The prompt instructs Claude to:
- Use the waterfall to understand the IS logic for this company (rather than assuming a standard template)
- Use parent-child relationships to resolve ambiguous sub-item classifications
- Use `computed_as` fields to understand cross-section sums (EBITDA = Gross Profit − SG&A)

### No breaking changes to the output

Layer 2 output shape stays identical. The `values`, `reasoning`, `validation`, `flaggedFields` etc. keys are unchanged. Step 2/3 UI requires no changes.

### Service changes

`layer2_service.py` `run_classification()`:
- Accept optional `structured: Optional[Dict] = None` parameter
- If provided, inject into prompt variables as `structured_json: json.dumps(structured, indent=2)`
- If absent, inject `structured_json: "(not available)"` — graceful fallback

### Route changes

`layer2.py` `run_layer2()`:
- Accept optional `structured: Optional[Dict] = None` in `Layer2Request`
- Pass through to service

### Frontend changes

`client.ts` `runLayer2()`:
- Accept optional `structured?: Layer1Template` parameter
- Include in request body if provided

`Step2Classify.tsx`:
- Pass `layer1Results[statementType]?.structured` to `runLayer2()` call

---

## Task Board

### 🔲 Backend: Layer 2 service + route

- Add `structured: Optional[Dict] = None` to `Layer2Request` schema
- Update `layer2_service.py` `run_classification()` to accept + inject `structured`
- Update `layer2.py` route to pass `structured` through

### 🔲 Prompts: inject structured context

For each of `layer2_income_statement.md`, `layer2_balance_sheet.md`, `layer2_cash_flow_statement.md`:
- Add `{structured_json}` variable block before the CSV input section
- IS prompt: instruct Claude to use `waterfall` for P&L reconciliation
- BS/CFS prompts: instruct Claude to use parent-child groupings

### 🔲 Frontend: pass structured to Layer 2

- Update `Layer2Request` type in `types/index.ts` to include `structured?: Layer1Template`
- Update `runLayer2()` in `client.ts` to include `structured` in body
- Update `Step2Classify.tsx` to pass `layer1Results[statementType]?.structured`

---

## Dependency

All three tasks above are independent and can be implemented in parallel.
Implementation blocked on: **Layer 1 producing consistent structured output** (needs real-world testing with at least 3 portfolio companies before relying on the structured tree in Layer 2 prompts).

---

## LTM Adj EBITDA

Per the original design decision: the LTM Adj EBITDA section in Layer 2 output remains **empty** pending iLevel integration. Layer 1 detects LTM rows and excludes them from the IS waterfall. Layer 2 should continue to emit null for LTM Adj EBITDA fields.
