/**
 * TemplateEditor — tabbed flat-operator template editor for all statement types.
 *
 * Architecture: delegates all row rendering/interaction to TemplateRightPanel
 * (shared with LayoutReconciliation). This file handles the outer shell:
 * tabs, source column, header, save logic.
 */
import { useState, useRef } from 'react'
import type { Layer1Response, SourceLayoutRow, TemplateStatementConfig, StepCRow } from '../../types'
import {
  saveLayer1Template,
  saveLayout,
  applyTemplateChanges,
  runLayer1Deterministic,
  runLayer1,
  extractSourceRows,
} from '../../api/client'
import { type TNode, EMPTY_SELECTION, type SelectionState } from './templateRowTypes'
import { templateToRows, rowsToTemplate, buildChangeSet, fmtVal } from './templateRowHelpers'
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

// ── ColBadge — click-to-edit column letter indicator ─────────────────────────

function ColBadge({
  colLetter, field, isEditing, draft,
  onEdit, onDraftChange, onConfirm, onCancel, disabled,
}: {
  colLetter: string; field: string; isEditing: boolean; draft: string
  onEdit: () => void; onDraftChange: (d: string) => void
  onConfirm: () => void; onCancel: () => void; disabled: boolean
}) {
  if (isEditing) {
    return (
      <span className="flex items-center gap-0.5">
        <span className="text-slate-400">(col</span>
        <input
          autoFocus
          className="w-8 border border-blue-400 rounded px-1 text-[10px] font-mono text-blue-700 outline-none"
          value={draft}
          onChange={e => onDraftChange(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === 'Enter') onConfirm(); if (e.key === 'Escape') onCancel() }}
        />
        <button onClick={onConfirm} disabled={disabled || !draft.trim()} className="text-blue-500 hover:text-blue-700 text-[10px] disabled:opacity-40">↺</button>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 text-[10px]">✕</button>
        <span className="text-slate-400">)</span>
      </span>
    )
  }
  return (
    <button
      onClick={onEdit}
      disabled={disabled}
      className="text-slate-400 hover:text-blue-500 font-mono text-[10px] disabled:opacity-40"
      title={`Click to change ${field} column`}
    >
      ({colLetter})
    </button>
  )
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STMT_LABELS: Record<string, string> = {
  income_statement:    'Income Statement',
  balance_sheet:       'Balance Sheet',
  cash_flow_statement: 'Cash Flow Statement',
}

const STMT_SHORT: Record<string, string> = {
  income_statement:    'IS',
  balance_sheet:       'BS',
  cash_flow_statement: 'CFS',
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TemplateEditor({
  statements,
  companyId,
  sessionId,
  reportingPeriod,
  sharedTab,
  onSaved,
  onCancel,
}: Props) {
  const [activeTab, setActiveTab] = useState(statements[0]?.statementType ?? 'income_statement')
  const [allRows, setAllRows] = useState<Record<string, TNode[]>>(() =>
    Object.fromEntries(
      statements.map(s => [
        s.statementType,
        s.existingTemplate ? templateToRows(s.existingTemplate, s.stepCRows, s.statementType) : [],
      ]),
    ),
  )
  const [hoveredRow, setHoveredRow] = useState<number | null>(null)
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Per-statement column tracking — keyed by statementType
  const [colInfo, setColInfo] = useState<Record<string, { label: string; value: string }>>(() =>
    Object.fromEntries(
      statements.map(s => [s.statementType, {
        label: s.labelColLetter ?? '?',
        value: s.valueColLetter ?? '?',
      }]),
    ),
  )
  // Editing state: which statement + which col ('label' | 'value') is being edited
  const [colEdit, setColEdit] = useState<{ stmt: string; field: 'label' | 'value'; draft: string } | null>(null)
  const [reextracting, setReextracting] = useState(false)

  // Per-statement stepCRows (can change after re-extract)
  const [allStepCRows, setAllStepCRows] = useState<Record<string, StepCRow[]>>(() =>
    Object.fromEntries(statements.map(s => [s.statementType, s.stepCRows])),
  )

  const rightPanelRef = useRef<TemplateRightPanelHandle>(null)

  const activeConfig = statements.find(s => s.statementType === activeTab)
  const activeRows = allRows[activeTab] ?? []
  const activeStepCRows = allStepCRows[activeTab] ?? activeConfig?.stepCRows ?? []
  const activeColInfo = colInfo[activeTab] ?? { label: '?', value: '?' }

  // ── Column re-extract ──────────────────────────────────────────────────────

  async function handleReextract(stmt: string, labelColLetter: string, valueColLetter: string) {
    if (!activeConfig) return
    setReextracting(true)
    setError(null)
    const config = statements.find(s => s.statementType === stmt)
    if (!config) { setReextracting(false); return }

    const labelColNum = colLetterToIndex(labelColLetter)
    const valueColNum = colLetterToIndex(valueColLetter)
    const isLabelChange = labelColLetter !== (colInfo[stmt]?.label ?? '?')

    try {
      if (isLabelChange) {
        // Label column changed → full re-extraction, AI rebuilds template
        const result = await runLayer1(
          sessionId, config.sheetName, stmt, reportingPeriod,
          undefined, companyId, sharedTab ?? false,
          undefined,
          /* explicitLabelCol */ labelColNum,
        )
        if (result.sourceRows) setAllStepCRows(p => ({ ...p, [stmt]: result.sourceRows! }))
        setColInfo(p => ({ ...p, [stmt]: { label: result.labelColLetter ?? labelColLetter, value: result.valueColLetter ?? valueColLetter } }))
        // Rebuild right panel from AI output
        if (result.structured) {
          const aiTmpl = buildAiTemplate(result.structured, stmt)
          if (aiTmpl) setAllRows(p => ({ ...p, [stmt]: templateToRows(aiTmpl as any, result.sourceRows ?? [], stmt) }))
        }
        // Auto-save label col override
        if (companyId && labelColNum) {
          fetch(`/api/admin/companies/${companyId}/label-column`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label_col: labelColNum }),
          }).catch(() => {})
        }
      } else {
        // Only value column changed → refresh source rows only
        const result = await extractSourceRows(
          sessionId, config.sheetName, stmt, reportingPeriod,
          sharedTab ?? false, undefined, companyId,
          undefined, valueColNum,
        )
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
    const upper = letter.toUpperCase().trim()
    for (let i = 0; i < upper.length; i++) {
      index = index * 26 + (upper.charCodeAt(i) - 64)
    }
    return index
  }

  function buildAiTemplate(structured: any, stmtType: string) {
    const waterfallOps = new Map<number, any>()
    ;(structured?.waterfall ?? []).forEach((w: any) => { waterfallOps.set(w.row_id, w.operator ?? null) })
    const hasWaterfall = waterfallOps.size > 0
    const isBsOrCfs = stmtType === 'balance_sheet' || stmtType === 'cash_flow_statement'
    function convertRow(r: any): any {
      const children = r.children ?? []
      const op = isBsOrCfs ? null : hasWaterfall && r.id != null && waterfallOps.has(r.id) ? waterfallOps.get(r.id) : children.length > 0 ? null : r.type === 'sum' ? '=' : '+'
      if (children.length > 0) {
        const flat = children.flatMap((c: any) => {
          const gc = c.children ?? []
          if (gc.length > 0) return [...gc.map((g: any) => ({ ...g, operator: '+', children: [] })), { ...c, operator: '+', children: [] }]
          return [{ ...c, operator: '+', children: [] }]
        })
        return { ...r, operator: op, expanded: true, children: flat }
      }
      return { ...r, operator: op, children: [] }
    }
    return {
      meta: { statement_type: stmtType, created_at: new Date().toISOString(), schema_version: 2 },
      rows: (structured?.rows ?? []).map(convertRow),
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const results: Record<string, Layer1Response> = {}

      await Promise.all(
        statements.map(async config => {
          const rows = allRows[config.statementType] ?? []
          const template = rowsToTemplate(rows, config.statementType)
          const layoutRows: SourceLayoutRow[] = config.stepCRows.map(r => ({
            row_index: r.row_index,
            label: r.label,
          }))

          const { renames, additions, deletions } = buildChangeSet(config.existingTemplate, rows)

          await Promise.all([
            saveLayer1Template(companyId, config.statementType, template),
            saveLayout(companyId, config.statementType, layoutRows),
          ])

          if (renames.length > 0 || additions.length > 0 || deletions.length > 0) {
            applyTemplateChanges(companyId, config.statementType, renames, additions, deletions)
              .catch(e => console.warn('[TemplateEditor] apply-changes non-fatal:', e))
          }

          const result = await runLayer1Deterministic(
            sessionId,
            config.sheetName,
            config.statementType,
            reportingPeriod,
            companyId,
            template,
            sharedTab ?? false,
          )
          results[config.statementType] = result
        }),
      )

      onSaved(results)
    } catch (e: any) {
      setError(e.message ?? 'Failed to save templates')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-50">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-2.5 flex-shrink-0" style={{ backgroundColor: '#0f172a' }}>
        <div>
          <div className="text-sm font-semibold text-white">Template Editor</div>
          <div className="text-xs text-slate-400">{reportingPeriod}</div>
        </div>
        <div className="flex-1" />
        {error && <span className="text-xs text-red-400 mr-2">{error}</span>}
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-slate-400 border border-slate-600 rounded-md hover:text-white hover:border-slate-400 transition-colors"
        >
          ← Back
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save All & Extract'}
        </button>
      </div>

      {/* Statement tabs */}
      <div className="flex-shrink-0 flex items-center gap-1 px-4 py-1.5 bg-slate-800 border-b border-slate-700">
        {statements.map(s => (
          <button
            key={s.statementType}
            onClick={() => { setActiveTab(s.statementType); setSelection(EMPTY_SELECTION) }}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              activeTab === s.statementType
                ? 'bg-white text-slate-800'
                : 'text-slate-400 hover:text-white hover:bg-slate-700'
            }`}
          >
            {STMT_SHORT[s.statementType]} — {s.sheetName}
          </button>
        ))}
      </div>

      {/* Two-panel body */}
      {activeConfig && (
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
                {/* Label col header with editable column letter */}
                <span className="flex items-center gap-1">
                  Label
                  <ColBadge
                    colLetter={activeColInfo.label}
                    field="label"
                    isEditing={colEdit?.stmt === activeTab && colEdit.field === 'label'}
                    draft={colEdit?.stmt === activeTab && colEdit.field === 'label' ? colEdit.draft : ''}
                    onEdit={() => setColEdit({ stmt: activeTab, field: 'label', draft: activeColInfo.label })}
                    onDraftChange={d => setColEdit(e => e ? { ...e, draft: d } : null)}
                    onConfirm={() => colEdit && handleReextract(activeTab, colEdit.draft, activeColInfo.value)}
                    onCancel={() => setColEdit(null)}
                    disabled={reextracting}
                  />
                </span>
                {/* Value col header with editable column letter */}
                <span className="flex items-center justify-end gap-1 pr-1">
                  Value
                  <ColBadge
                    colLetter={activeColInfo.value}
                    field="value"
                    isEditing={colEdit?.stmt === activeTab && colEdit.field === 'value'}
                    draft={colEdit?.stmt === activeTab && colEdit.field === 'value' ? colEdit.draft : ''}
                    onEdit={() => setColEdit({ stmt: activeTab, field: 'value', draft: activeColInfo.value })}
                    onDraftChange={d => setColEdit(e => e ? { ...e, draft: d } : null)}
                    onConfirm={() => colEdit && handleReextract(activeTab, activeColInfo.label, colEdit.draft)}
                    onCancel={() => setColEdit(null)}
                    disabled={reextracting}
                  />
                </span>
              </div>
              <div className="flex-1 overflow-y-auto">
                {activeStepCRows.map(sr => {
                  const isEmpty = !sr.label
                  const isTitleRow = Boolean(sr.label) && sr.value === null
                  const isUsedRows = allRows[activeTab] ?? []
                  const usedSet = new Set(
                    isUsedRows.flatMap(r => {
                      const collected: number[] = []
                      const walk = (n: TNode) => { if (n.source_row > 0) collected.push(n.source_row); n.children.forEach(walk) }
                      walk(r)
                      return collected
                    }),
                  )
                  const isUsed = usedSet.has(sr.row_index)
                  // Source rows use 'src:N' keys so they don't collide with template paths
                  const srcKey = `src:${sr.row_index}`
                  const isHovered = !selection.selectedPaths.size && hoveredRow === sr.row_index
                  const isSelected = selection.selectedPaths.has(srcKey)
                  const isDraggable = !isEmpty && !isTitleRow && !isUsed
                  return (
                    <div
                      key={sr.row_index}
                      draggable={isDraggable}
                      onDragStart={isDraggable ? e => {
                        // Delegate to TemplateRightPanel's useDragDrop so it tracks drag state
                        rightPanelRef.current?.startSourceDrag(e, sr.row_index)
                      } : undefined}
                      onMouseEnter={() => { if (!selection.selectedPaths.size) setHoveredRow(sr.row_index) }}
                      onMouseLeave={() => { if (!selection.selectedPaths.size && hoveredRow === sr.row_index) setHoveredRow(null) }}
                      onClick={e => {
                        if (!isDraggable && !isUsed) return
                        // Build a fake "path" for source rows using srcKey
                        const allSrcNodes = activeStepCRows
                          .filter(r => !(!r.label) && !(Boolean(r.label) && r.value === null))
                          .map(r => ({ id: r.row_index, source_row: r.row_index, label: r.label, operator: null as any, expanded: false, children: [] }))
                        const srcIdx = allSrcNodes.findIndex(r => r.source_row === sr.row_index)
                        if (srcIdx === -1) return
                        const fakePath = [srcIdx]
                        // Use prefix in selected paths to distinguish source from template
                        const fakeKey = srcKey
                        if (e.shiftKey && selection.anchorPath) {
                          // range select among source rows
                          const anchorRow = selection.anchorPath.startsWith('src:') ? parseInt(selection.anchorPath.slice(4)) : null
                          if (anchorRow !== null) {
                            const allDraggableSrc = activeStepCRows.filter(r => r.label && !(Boolean(r.label) && r.value === null) && !usedSet.has(r.row_index))
                            const anchorIdx = allDraggableSrc.findIndex(r => r.row_index === anchorRow)
                            const clickedIdx = allDraggableSrc.findIndex(r => r.row_index === sr.row_index)
                            if (anchorIdx !== -1 && clickedIdx !== -1) {
                              const lo = Math.min(anchorIdx, clickedIdx), hi = Math.max(anchorIdx, clickedIdx)
                              const rangeKeys = new Set(allDraggableSrc.slice(lo, hi + 1).map(r => `src:${r.row_index}`))
                              setSelection(prev => ({ selectedPaths: rangeKeys, anchorPath: prev.anchorPath }))
                              return
                            }
                          }
                        }
                        if (e.ctrlKey || e.metaKey) {
                          setSelection(prev => {
                            const next = new Set(prev.selectedPaths)
                            if (next.has(fakeKey)) next.delete(fakeKey); else next.add(fakeKey)
                            return { selectedPaths: next, anchorPath: fakeKey }
                          })
                        } else {
                          setSelection(prev => prev.selectedPaths.size === 1 && prev.selectedPaths.has(fakeKey)
                            ? { selectedPaths: new Set(), anchorPath: null }
                            : { selectedPaths: new Set([fakeKey]), anchorPath: fakeKey }
                          )
                        }
                      }}
                      className={`grid grid-cols-[36px_1fr_80px] items-center px-2 min-h-[26px] border-b border-slate-50 transition-colors
                        ${isDraggable ? 'cursor-grab hover:bg-blue-50' : isUsed ? 'opacity-30' : ''}
                        ${isHovered ? '!bg-yellow-100' : ''}
                        ${isSelected ? '!bg-blue-100 border-l-2 border-blue-500' : ''}
                      `}
                    >
                      <span className="text-[10px] text-slate-400 font-mono text-center">{sr.row_index}</span>
                      <span
                        className={`text-xs truncate ${!sr.label ? 'invisible' : 'text-slate-700'}`}
                        style={{
                          paddingLeft: 6 + (sr.indent ?? 0) * 14,
                          fontWeight: sr.bold ? 700 : 400,
                          fontStyle: sr.italic ? 'italic' : 'normal',
                        }}
                      >
                        {sr.label || ' '}
                      </span>
                      <span className={`text-[11px] font-mono text-right pr-1 ${sr.value != null && sr.value < 0 ? 'text-red-600' : 'text-slate-500'}`}>
                        {fmtVal(sr.value)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* RIGHT — shared template panel */}
            <TemplateRightPanel
              ref={rightPanelRef}
              key={activeTab}
              rows={activeRows}
              onRowsChange={rows => setAllRows(prev => ({ ...prev, [activeTab]: rows }))}
              sourceRows={activeStepCRows}
              hoveredRow={hoveredRow}
              onHoverChange={setHoveredRow}
              selection={selection}
              onSelectionChange={setSelection}
              dragOptions={{}}
            />
          </div>
        </div>
      )}
    </div>
  )
}
