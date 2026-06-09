/**
 * TemplateConfigurationWorkflow — unified tabbed template configuration.
 *
 * Replaces the old TemplateEditor (2-panel only) + LayoutReconciliation
 * (3-panel only, single statement) with a single tabbed component where
 * each tab independently shows either:
 *   - 2-panel (StatementPanel): panelMode === 'configure'
 *   - 3-panel (ReconciliationPanel): panelMode === 'reconcile'
 *
 * This eliminates the gap where statements were silently dropped when any
 * one statement triggered reconciliation.
 */
import { useState, useRef } from 'react'
import type {
  Layer1Response,
  SourceLayoutRow,
  TemplateStatementConfig,
  StepCRow,
} from '../../types'
import {
  saveLayer1Template,
  saveLayout,
  applyTemplateChanges,
  runLayer1Deterministic,
  runLayer1,
  extractSourceRows,
} from '../../api/client'
import {
  type TNode,
  type SelectionState,
  EMPTY_SELECTION,
  cloneTree,
  getNodeByPath,
} from './templateRowTypes'
import {
  templateToRows,
  rowsToTemplate,
  buildChangeSet,
  fmtVal,
} from './templateRowHelpers'
import TemplateRightPanel, { type TemplateRightPanelHandle } from './TemplateRightPanel'

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  statements: TemplateStatementConfig[]
  companyId: number
  sessionId: string
  reportingPeriod: string
  sharedTab?: boolean
  onSaved: (results: Record<string, Layer1Response>) => void
  onCancel: () => void
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STMT_SHORT: Record<string, string> = {
  income_statement:    'IS',
  balance_sheet:       'BS',
  cash_flow_statement: 'CFS',
}

// ── Reconcile helpers (from LayoutReconciliation) ─────────────────────────────

function buildDiffSets(diff: import('../../types').LayoutDiffChange[]) {
  const renames = new Map<number, { oldLabel: string; newLabel: string }>()
  const removedRowIndices = new Set<number>()
  const addedRowIndices = new Set<number>()
  const renamedOldRowIndices = new Set<number>()
  diff.forEach(c => {
    if (c.silent) return
    if (c.type === 'rename' && c.old && c.new) {
      renames.set(c.new.row_index, { oldLabel: c.old.label, newLabel: c.new.label })
      renamedOldRowIndices.add(c.old.row_index)
    } else if (c.type === 'remove' && c.old) {
      removedRowIndices.add(c.old.row_index)
    } else if (c.type === 'add' && c.new) {
      addedRowIndices.add(c.new.row_index)
    }
  })
  return { renames, removedRowIndices, addedRowIndices, renamedOldRowIndices }
}

function annotateNodes(
  nodes: TNode[],
  renames: Map<number, { oldLabel: string; newLabel: string }>,
  removedRowIndices: Set<number>,
): TNode[] {
  return nodes.map(n => ({
    ...n,
    label: renames.get(n.source_row)?.newLabel ?? n.label,
    isDead: removedRowIndices.has(n.source_row),
    isRenamed: renames.has(n.source_row),
    pendingRenameFrom: renames.get(n.source_row)?.oldLabel,
    children: annotateNodes(n.children, renames, removedRowIndices),
  }))
}

// ── ColBadge (from TemplateEditor) ────────────────────────────────────────────

function ColBadge({ colLetter, field, isEditing, draft, onEdit, onDraftChange, onConfirm, onCancel, disabled }: {
  colLetter: string; field: string; isEditing: boolean; draft: string
  onEdit: () => void; onDraftChange: (d: string) => void
  onConfirm: () => void; onCancel: () => void; disabled: boolean
}) {
  if (isEditing) {
    return (
      <span className="flex items-center gap-0.5">
        <span className="text-slate-400">(col</span>
        <input autoFocus className="w-8 border border-blue-400 rounded px-1 text-[10px] font-mono text-blue-700 outline-none"
          value={draft} onChange={e => onDraftChange(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === 'Enter') onConfirm(); if (e.key === 'Escape') onCancel() }} />
        <button onClick={onConfirm} disabled={disabled || !draft.trim()} className="text-blue-500 hover:text-blue-700 text-[10px] disabled:opacity-40">↺</button>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 text-[10px]">✕</button>
        <span className="text-slate-400">)</span>
      </span>
    )
  }
  return (
    <button onClick={onEdit} disabled={disabled} className="text-slate-400 hover:text-blue-500 font-mono text-[10px] disabled:opacity-40" title={`Click to change ${field} column`}>
      ({colLetter})
    </button>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function TemplateConfigurationWorkflow({
  statements,
  companyId,
  sessionId,
  reportingPeriod,
  sharedTab,
  onSaved,
  onCancel,
}: Props) {
  const [activeTab, setActiveTab] = useState(statements[0]?.statementType ?? 'income_statement')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Per-tab row state — initialized with annotations for reconcile tabs
  const [allRows, setAllRows] = useState<Record<string, TNode[]>>(() =>
    Object.fromEntries(statements.map(s => {
      if (s.panelMode === 'reconcile' && s.reconcileData && s.existingTemplate) {
        const { renames, removedRowIndices } = buildDiffSets(s.reconcileData.diff)
        const base = templateToRows(s.existingTemplate, s.stepCRows, s.statementType)
        return [s.statementType, annotateNodes(base, renames, removedRowIndices)]
      }
      return [s.statementType, s.existingTemplate ? templateToRows(s.existingTemplate, s.stepCRows, s.statementType) : []]
    })),
  )

  // Per-tab source rows (can update after column re-extract)
  const [allStepCRows, setAllStepCRows] = useState<Record<string, StepCRow[]>>(() =>
    Object.fromEntries(statements.map(s => [s.statementType, s.stepCRows])),
  )

  // Per-tab column info
  const [colInfo, setColInfo] = useState<Record<string, { label: string; value: string }>>(() =>
    Object.fromEntries(statements.map(s => [s.statementType, { label: s.labelColLetter ?? '?', value: s.valueColLetter ?? '?' }])),
  )
  const [colEdit, setColEdit] = useState<{ stmt: string; field: 'label' | 'value'; draft: string } | null>(null)
  const [reextracting, setReextracting] = useState(false)

  // Per-tab hover/selection (reset on tab switch)
  const [hoveredRow, setHoveredRow] = useState<number | null>(null)
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION)

  const rightPanelRef = useRef<TemplateRightPanelHandle>(null)

  const activeConfig = statements.find(s => s.statementType === activeTab)!
  const activeRows = allRows[activeTab] ?? []
  const activeStepCRows = allStepCRows[activeTab] ?? activeConfig?.stepCRows ?? []
  const activeColInfo = colInfo[activeTab] ?? { label: '?', value: '?' }

  // ── Column re-extract (configure tabs only) ────────────────────────────────

  async function handleReextract(stmt: string, labelColLetter: string, valueColLetter: string) {
    setReextracting(true)
    setError(null)
    const config = statements.find(s => s.statementType === stmt)
    if (!config) { setReextracting(false); return }
    const labelColNum = colLetterToIndex(labelColLetter)
    const valueColNum = colLetterToIndex(valueColLetter)
    const isLabelChange = labelColLetter !== (colInfo[stmt]?.label ?? '?')
    try {
      if (isLabelChange) {
        const result = await runLayer1(sessionId, config.sheetName, stmt, reportingPeriod, undefined, companyId, sharedTab ?? false, undefined, labelColNum)
        if (result.sourceRows) setAllStepCRows(p => ({ ...p, [stmt]: result.sourceRows! }))
        setColInfo(p => ({ ...p, [stmt]: { label: result.labelColLetter ?? labelColLetter, value: result.valueColLetter ?? valueColLetter } }))
        if (result.structured) {
          const aiTmpl = buildAiTemplate(result.structured, stmt)
          if (aiTmpl) setAllRows(p => ({ ...p, [stmt]: templateToRows(aiTmpl as any, result.sourceRows ?? [], stmt) }))
        }
        if (companyId && labelColNum) {
          fetch(`/api/admin/companies/${companyId}/label-column`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label_col: labelColNum }) }).catch(() => {})
        }
      } else {
        const result = await extractSourceRows(sessionId, config.sheetName, stmt, reportingPeriod, sharedTab ?? false, undefined, companyId, undefined, valueColNum)
        if (result.sourceRows) setAllStepCRows(p => ({ ...p, [stmt]: result.sourceRows! }))
        setColInfo(p => ({ ...p, [stmt]: { label: result.labelColLetter ?? labelColLetter, value: result.valueColLetter ?? valueColLetter } }))
      }
    } catch (e: any) {
      setError(`Re-extract failed: ${e.message}`)
    } finally {
      setReextracting(false)
      setColEdit(null)
    }
  }

  function colLetterToIndex(letter: string): number {
    let index = 0
    for (let i = 0; i < letter.toUpperCase().trim().length; i++) {
      index = index * 26 + (letter.toUpperCase().trim().charCodeAt(i) - 64)
    }
    return index
  }

  function buildAiTemplate(structured: any, stmtType: string) {
    const waterfallOps = new Map<number, any>()
    ;(structured?.waterfall ?? []).forEach((w: any) => { const op = w.operator ?? null; waterfallOps.set(w.row_id, op === null ? '+' : op) })
    const hasWaterfall = waterfallOps.size > 0
    const isBsOrCfs = stmtType === 'balance_sheet' || stmtType === 'cash_flow_statement'
    function convertRow(r: any): any {
      const children = r.children ?? []
      const op = isBsOrCfs ? null : hasWaterfall && r.id != null && waterfallOps.has(r.id) ? waterfallOps.get(r.id) : children.length > 0 ? null : r.type === 'sum' ? '=' : '+'
      if (children.length > 0) {
        const flat = children.flatMap((c: any) => { const gc = c.children ?? []; if (gc.length > 0) return [...gc.map((g: any) => ({ ...g, operator: '+', children: [] })), { ...c, operator: '+', children: [] }]; return [{ ...c, operator: '+', children: [] }] })
        return { ...r, operator: op, expanded: true, children: flat }
      }
      return { ...r, operator: op, children: [] }
    }
    return { meta: { statement_type: stmtType, created_at: new Date().toISOString(), schema_version: 2 }, rows: (structured?.rows ?? []).map(convertRow) }
  }

  // ── Rename confirm (reconcile tabs) ────────────────────────────────────────

  function handleRenameConfirm(stmt: string) {
    return (targetPath: number[], sourceRow: number) => {
      const sr = allStepCRows[stmt]?.find(r => r.row_index === sourceRow)
      if (!sr) return
      setAllRows(prev => {
        const tree = cloneTree(prev[stmt] ?? [])
        const target = getNodeByPath(tree, targetPath)
        if (target) {
          target.source_row = sr.row_index
          target.label = sr.label
          target.isRenamed = false
          target.isDead = false
          target.pendingRenameFrom = undefined
        }
        return { ...prev, [stmt]: tree }
      })
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const results: Record<string, Layer1Response> = {}

      await Promise.all(statements.map(async config => {
        const rows = allRows[config.statementType] ?? []
        const template = rowsToTemplate(rows, config.statementType)
        const layoutRows: SourceLayoutRow[] = (allStepCRows[config.statementType] ?? config.stepCRows).map(r => ({ row_index: r.row_index, label: r.label }))

        let renames: Array<{ old_label: string; new_label: string }> = []
        let additions: string[] = []
        let deletions: string[] = []

        if (config.panelMode === 'reconcile') {
          // Reconcile: derive changes from row annotations
          rows.forEach(r => {
            if (r.isDead) deletions.push(r.label)
            else if (r.pendingRenameFrom) renames.push({ old_label: r.pendingRenameFrom, new_label: r.label })
          })
          const oldLabels = new Set((config.existingTemplate?.rows ?? []).map(r => r.label))
          rows.forEach(r => { if (!oldLabels.has(r.label) && !r.isDead) additions.push(r.label) })
        } else {
          // Configure: compute changes from buildChangeSet
          const cs = buildChangeSet(config.existingTemplate, rows)
          renames = cs.renames; additions = cs.additions; deletions = cs.deletions
        }

        await Promise.all([
          saveLayer1Template(companyId, config.statementType, template),
          saveLayout(companyId, config.statementType, layoutRows),
        ])

        if (renames.length > 0 || additions.length > 0 || deletions.length > 0) {
          applyTemplateChanges(companyId, config.statementType, renames, additions, deletions)
            .catch(e => console.warn('[Workflow] apply-changes non-fatal:', e))
        }

        const result = await runLayer1Deterministic(
          sessionId, config.sheetName, config.statementType, reportingPeriod, companyId, template, sharedTab ?? false,
        )
        results[config.statementType] = result
      }))

      onSaved(results)
    } catch (e: any) {
      setError(e.message ?? 'Failed to save templates')
    } finally {
      setSaving(false)
    }
  }

  // ── Tab badge ──────────────────────────────────────────────────────────────

  const anyReconcile = statements.some(s => s.panelMode === 'reconcile')
  const anyHasDead = statements.some(s => (allRows[s.statementType] ?? []).some(r => r.isDead))

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-50">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-2.5 flex-shrink-0" style={{ backgroundColor: '#0f172a' }}>
        <div>
          <div className="text-sm font-semibold text-white">Template Configuration</div>
          <div className="text-xs text-slate-400">{reportingPeriod}{anyReconcile ? ' · Layout changes detected on some statements' : ''}</div>
        </div>
        <div className="flex-1" />
        {error && <span className="text-xs text-red-400 mr-2">{error}</span>}
        {anyHasDead && <span className="text-xs text-amber-400 mr-2">Remove or keep red rows before saving</span>}
        <button onClick={onCancel} className="px-3 py-1.5 text-xs text-slate-400 border border-slate-600 rounded-md hover:text-white hover:border-slate-400 transition-colors">← Back</button>
        <button onClick={handleSave} disabled={saving} className="px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {saving ? 'Saving…' : 'Save All & Extract'}
        </button>
      </div>

      {/* Tabs — badge on reconcile tabs */}
      <div className="flex-shrink-0 flex items-center gap-1 px-4 py-1.5 bg-slate-800 border-b border-slate-700">
        {statements.map(s => (
          <button
            key={s.statementType}
            onClick={() => { setActiveTab(s.statementType); setSelection(EMPTY_SELECTION); setHoveredRow(null) }}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === s.statementType ? 'bg-white text-slate-800' : 'text-slate-400 hover:text-white hover:bg-slate-700'
            }`}
          >
            {STMT_SHORT[s.statementType]} — {s.sheetName}
            {s.panelMode === 'reconcile' && (
              <span className="text-[9px] bg-amber-500 text-white px-1 py-0.5 rounded font-bold">!</span>
            )}
          </button>
        ))}

        {/* Reconcile legend — only shown when active tab is reconcile */}
        {activeConfig?.panelMode === 'reconcile' && (
          <div className="ml-auto flex items-center gap-3 text-[10px]">
            <span className="text-slate-400">Changes:</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" /><span className="text-slate-300">Added</span></span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /><span className="text-slate-300">Renamed</span></span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /><span className="text-slate-300">Removed</span></span>
          </div>
        )}
      </div>

      {/* Active tab content */}
      {activeConfig && (
        activeConfig.panelMode === 'reconcile'
          ? <ReconciliationPanel
              config={activeConfig}
              rows={activeRows}
              onRowsChange={rows => setAllRows(p => ({ ...p, [activeConfig.statementType]: rows }))}
              hoveredRow={hoveredRow}
              onHoverChange={setHoveredRow}
              selection={selection}
              onSelectionChange={setSelection}
              onRenameConfirm={handleRenameConfirm(activeConfig.statementType)}
              key={activeTab}
            />
          : <ConfigurePanel
              config={activeConfig}
              rows={activeRows}
              onRowsChange={rows => setAllRows(p => ({ ...p, [activeConfig.statementType]: rows }))}
              stepCRows={activeStepCRows}
              colInfo={activeColInfo}
              colEdit={activeTab === colEdit?.stmt ? colEdit : null}
              onColEdit={edit => setColEdit(edit ? { ...edit, stmt: activeTab } : null)}
              onReextract={(lbl, val) => handleReextract(activeTab, lbl, val)}
              reextracting={reextracting}
              hoveredRow={hoveredRow}
              onHoverChange={setHoveredRow}
              selection={selection}
              onSelectionChange={setSelection}
              rightPanelRef={rightPanelRef}
              key={activeTab}
            />
      )}
    </div>
  )
}

// ── ConfigurePanel — 2-panel (source column + template) ───────────────────────

function ConfigurePanel({
  config, rows, onRowsChange, stepCRows, colInfo, colEdit, onColEdit,
  onReextract, reextracting, hoveredRow, onHoverChange, selection, onSelectionChange, rightPanelRef,
}: {
  config: TemplateStatementConfig
  rows: TNode[]
  onRowsChange: (rows: TNode[]) => void
  stepCRows: StepCRow[]
  colInfo: { label: string; value: string }
  colEdit: { stmt: string; field: 'label' | 'value'; draft: string } | null
  onColEdit: (edit: { stmt: string; field: 'label' | 'value'; draft: string } | null) => void
  onReextract: (labelCol: string, valueCol: string) => void
  reextracting: boolean
  hoveredRow: number | null
  onHoverChange: (row: number | null) => void
  selection: SelectionState
  onSelectionChange: (s: SelectionState) => void
  rightPanelRef: React.Ref<TemplateRightPanelHandle>
}) {
  const usedSet = new Set(
    rows.flatMap(r => { const c: number[] = []; const walk = (n: TNode) => { if (n.source_row > 0) c.push(n.source_row); n.children.forEach(walk) }; walk(r); return c }),
  )

  return (
    <div className="flex flex-1 overflow-hidden justify-center">
      <div className="flex w-full max-w-[1280px] overflow-hidden">
        {/* LEFT — source column */}
        <div className="flex flex-col border-r border-slate-200 bg-white overflow-hidden" style={{ width: '35%' }}>
          <div className="flex-shrink-0 px-3 py-1.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Source Sheet</span>
            {reextracting && <span className="text-[10px] text-blue-500 ml-1">Re-extracting…</span>}
          </div>
          <div className="flex-shrink-0 grid grid-cols-[36px_1fr_80px] px-2 py-1 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            <span></span>
            <span className="flex items-center gap-1">
              Label
              <ColBadge colLetter={colInfo.label} field="label" isEditing={colEdit?.field === 'label'} draft={colEdit?.field === 'label' ? colEdit.draft : ''}
                onEdit={() => onColEdit({ stmt: config.statementType, field: 'label', draft: colInfo.label })}
                onDraftChange={d => onColEdit(colEdit ? { ...colEdit, draft: d } : null)}
                onConfirm={() => colEdit && onReextract(colEdit.draft, colInfo.value)}
                onCancel={() => onColEdit(null)} disabled={reextracting} />
            </span>
            <span className="flex items-center justify-end gap-1 pr-1">
              Value
              <ColBadge colLetter={colInfo.value} field="value" isEditing={colEdit?.field === 'value'} draft={colEdit?.field === 'value' ? colEdit.draft : ''}
                onEdit={() => onColEdit({ stmt: config.statementType, field: 'value', draft: colInfo.value })}
                onDraftChange={d => onColEdit(colEdit ? { ...colEdit, draft: d } : null)}
                onConfirm={() => colEdit && onReextract(colInfo.label, colEdit.draft)}
                onCancel={() => onColEdit(null)} disabled={reextracting} />
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {stepCRows.map(sr => {
              const isEmpty = !sr.label
              const isTitleRow = Boolean(sr.label) && sr.value === null
              const isUsed = usedSet.has(sr.row_index)
              const srcKey = `src:${sr.row_index}`
              const isHovered = !selection.selectedPaths.size && hoveredRow === sr.row_index
              const isSelected = selection.selectedPaths.has(srcKey)
              const isDraggable = !isEmpty && !isTitleRow && !isUsed
              return (
                <div key={sr.row_index} draggable={isDraggable}
                  onDragStart={isDraggable ? e => { (rightPanelRef as any).current?.startSourceDrag(e, sr.row_index) } : undefined}
                  onMouseEnter={() => { if (!selection.selectedPaths.size) onHoverChange(sr.row_index) }}
                  onMouseLeave={() => { if (!selection.selectedPaths.size && hoveredRow === sr.row_index) onHoverChange(null) }}
                  onClick={e => {
                    if (!isDraggable && !isUsed) return
                    const fakeKey = srcKey
                    if (e.shiftKey && selection.anchorPath?.startsWith('src:')) {
                      const anchorRow = parseInt(selection.anchorPath.slice(4))
                      const draggable = stepCRows.filter(r => r.label && !(Boolean(r.label) && r.value === null) && !usedSet.has(r.row_index))
                      const ai = draggable.findIndex(r => r.row_index === anchorRow), ci = draggable.findIndex(r => r.row_index === sr.row_index)
                      if (ai !== -1 && ci !== -1) { const lo = Math.min(ai, ci), hi = Math.max(ai, ci); onSelectionChange({ selectedPaths: new Set(draggable.slice(lo, hi + 1).map(r => `src:${r.row_index}`)), anchorPath: selection.anchorPath }); return }
                    }
                    if (e.ctrlKey || e.metaKey) {
                      const next = new Set(selection.selectedPaths); if (next.has(fakeKey)) next.delete(fakeKey); else next.add(fakeKey)
                      onSelectionChange({ selectedPaths: next, anchorPath: fakeKey })
                    } else {
                      onSelectionChange(selection.selectedPaths.size === 1 && selection.selectedPaths.has(fakeKey) ? { selectedPaths: new Set(), anchorPath: null } : { selectedPaths: new Set([fakeKey]), anchorPath: fakeKey })
                    }
                  }}
                  className={`grid grid-cols-[36px_1fr_80px] items-center px-2 min-h-[26px] border-b border-slate-50 transition-colors
                    ${isDraggable ? 'cursor-grab hover:bg-blue-50' : isUsed ? 'opacity-30' : ''}
                    ${isHovered ? '!bg-yellow-100' : ''} ${isSelected ? '!bg-blue-100 border-l-2 border-blue-500' : ''}
                  `}
                >
                  <span className="text-[10px] text-slate-400 font-mono text-center">{sr.row_index}</span>
                  <span className={`text-xs truncate ${!sr.label ? 'invisible' : 'text-slate-700'}`}
                    style={{ paddingLeft: 6 + (sr.indent ?? 0) * 14, fontWeight: sr.bold ? 700 : 400, fontStyle: sr.italic ? 'italic' : 'normal' }}>
                    {sr.label || ' '}
                  </span>
                  <span className={`text-[11px] font-mono text-right pr-1 ${sr.value != null && sr.value < 0 ? 'text-red-600' : 'text-slate-500'}`}>{fmtVal(sr.value)}</span>
                </div>
              )
            })}
          </div>
        </div>
        {/* RIGHT — template panel */}
        <TemplateRightPanel ref={rightPanelRef} rows={rows} onRowsChange={onRowsChange}
          sourceRows={stepCRows} hoveredRow={hoveredRow} onHoverChange={onHoverChange}
          selection={selection} onSelectionChange={onSelectionChange} dragOptions={{}} />
      </div>
    </div>
  )
}

// ── ReconciliationPanel — 3-panel (old layout + new source + template) ────────

function ReconciliationPanel({
  config, rows, onRowsChange, hoveredRow, onHoverChange, selection, onSelectionChange, onRenameConfirm,
}: {
  config: TemplateStatementConfig
  rows: TNode[]
  onRowsChange: (rows: TNode[]) => void
  hoveredRow: number | null
  onHoverChange: (row: number | null) => void
  selection: SelectionState
  onSelectionChange: (s: SelectionState) => void
  onRenameConfirm: (targetPath: number[], sourceRow: number) => void
}) {
  const { diff = [], oldLayout = [] } = config.reconcileData ?? {}
  const { renames, removedRowIndices, addedRowIndices, renamedOldRowIndices } = buildDiffSets(diff)
  const newStepCRows = config.stepCRows

  const rightPanelRef = useRef<TemplateRightPanelHandle>(null)

  return (
    <div className="flex flex-1 overflow-hidden justify-center">
      <div className="flex w-full max-w-[1440px] overflow-hidden">
        {/* LEFT — old layout (read-only) */}
        <div className="flex flex-col border-r border-slate-200 bg-white overflow-hidden" style={{ width: '22%' }}>
          <div className="flex-shrink-0 px-3 py-1.5 bg-slate-50 border-b border-slate-200">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Previous Layout</span>
          </div>
          <div className="flex-shrink-0 grid grid-cols-[36px_1fr] px-2 py-1 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            <span></span><span>Label</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {oldLayout.map(r => {
              const isRemoved = removedRowIndices.has(r.row_index)
              const isRenamed = renamedOldRowIndices.has(r.row_index)
              return (
                <div key={r.row_index} className={`grid grid-cols-[36px_1fr] items-center px-2 min-h-[26px] border-b border-slate-50 select-none ${isRemoved ? 'bg-red-50' : isRenamed ? 'bg-amber-50' : ''}`}>
                  <span className="text-[10px] text-slate-400 font-mono text-center">{r.row_index}</span>
                  <span className={`text-xs px-1.5 truncate ${isRemoved ? 'text-red-600 line-through' : isRenamed ? 'text-amber-700' : !r.label ? 'text-transparent' : 'text-slate-600'}`}>{r.label || ' '}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* MIDDLE — new source (draggable) */}
        <div className="flex flex-col border-r border-slate-200 bg-white overflow-hidden" style={{ width: '22%' }}>
          <div className="flex-shrink-0 px-3 py-1.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">New Layout</span>
            <span className="text-[10px] bg-slate-200 text-slate-500 rounded-full px-2 py-0.5">{diff.filter(c => !c.silent).length} changes</span>
          </div>
          <div className="flex-shrink-0 grid grid-cols-[36px_1fr_72px] px-2 py-1 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            <span></span><span>Label</span><span className="text-right pr-1">Value</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {newStepCRows.map(sr => {
              const isTitleRow = Boolean(sr.label) && sr.value === null
              const isAdded = addedRowIndices.has(sr.row_index)
              const isRenamed = renames.has(sr.row_index)
              const isHovered = !selection.selectedPaths.size && hoveredRow === sr.row_index
              const isUsed = rows.some(r => !r.isDead && r.source_row === sr.row_index)
              const isDraggable = !isTitleRow && !isUsed
              return (
                <div key={sr.row_index} draggable={isDraggable}
                  onDragStart={isDraggable ? e => { rightPanelRef.current?.startNewSourceDrag(e, sr.row_index) } : undefined}
                  onMouseEnter={() => { if (!selection.selectedPaths.size) onHoverChange(sr.row_index) }}
                  onMouseLeave={() => { if (!selection.selectedPaths.size && hoveredRow === sr.row_index) onHoverChange(null) }}
                  className={`grid grid-cols-[36px_1fr_72px] items-center px-2 min-h-[26px] border-b border-slate-50 select-none transition-colors
                    ${isAdded ? 'bg-green-50' : isRenamed ? 'bg-amber-50' : ''}
                    ${isDraggable ? (!isAdded && !isRenamed ? 'cursor-grab hover:bg-blue-50' : 'cursor-grab') : isUsed ? 'opacity-30' : ''}
                    ${isHovered ? '!bg-yellow-100' : ''}
                  `}
                >
                  <span className="text-[10px] text-slate-400 font-mono text-center">{sr.row_index}</span>
                  <span className={`text-xs px-1.5 truncate ${isAdded ? 'text-green-700 font-medium' : isRenamed ? 'text-amber-700 font-medium' : !sr.label ? 'text-transparent' : 'text-slate-600'}`}>{sr.label || ' '}</span>
                  <span className={`text-[11px] font-mono text-right pr-1 ${sr.value != null && sr.value < 0 ? 'text-red-500' : 'text-slate-500'}`}>{fmtVal(sr.value)}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* RIGHT — template panel with reconcile coloring */}
        <TemplateRightPanel
          ref={rightPanelRef}
          rows={rows}
          onRowsChange={onRowsChange}
          sourceRows={newStepCRows}
          hoveredRow={hoveredRow}
          onHoverChange={onHoverChange}
          selection={selection}
          onSelectionChange={onSelectionChange}
          rowStatus={n => n.isDead ? 'dead' : n.isRenamed ? 'renamed' : 'normal'}
          dragOptions={{ onRenameConfirm }}
        />
      </div>
    </div>
  )
}
