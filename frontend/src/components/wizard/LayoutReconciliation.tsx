/**
 * LayoutReconciliation — 3-panel UI for resolving layout changes between uploads.
 *
 * Left panel:  Old source sheet (read-only, labels only) — shows deletions (red) and renames (yellow)
 * Middle panel: New source sheet (labels + values, draggable) — shows additions (green) and renames (yellow)
 * Right panel: Template editor (pre-populated, dead rows in red, renamed labels in yellow)
 *
 * On "Save Template & Extract":
 *   1. Saves new layout record + updated template to DB
 *   2. Runs deterministic IS extraction
 *   3. Calls onSaved(result)
 */
import { useCallback, useRef, useState } from 'react'
import type {
  Layer1Template,
  Layer1Response,
  SourceLayoutRow,
  LayoutDiffChange,
  Layer1TemplateRow,
} from '../../types'
import {
  saveLayer1Template,
  saveLayout,
  applyTemplateChanges,
  runLayer1Deterministic,
} from '../../api/client'
import type { StepCRow } from './TemplateEditor'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  oldLayout: SourceLayoutRow[]
  newStepCRows: StepCRow[]
  diff: LayoutDiffChange[]
  existingTemplate: Layer1Template
  statementType: string
  companyId: number
  sessionId: string
  reportingPeriod: string
  sheetName: string
  sharedTab?: boolean
  onSaved: (result: Layer1Response) => void
  onCancel: () => void
}

type Operator = '+' | '-' | '=' | null

interface TRow {
  id: number
  source_row: number
  label: string
  operator: Operator
  expanded: boolean
  children: TChild[]
  // Reconciliation status
  isDead?: boolean       // row exists in template but source row is gone (red)
  isRenamed?: boolean    // LCS detected a rename for this row (yellow)
  pendingRenameFrom?: string  // old label awaiting confirmation
}

interface TChild {
  id: number
  source_row: number
  label: string
  operator: Operator
}

let _nextId = 2000
function nextId() { return _nextId++ }

function fmtVal(v: number | null): string {
  if (v == null) return ''
  const abs = Math.abs(v).toLocaleString('en-US')
  return v < 0 ? `(${abs})` : abs
}

function opClass(op: Operator): string {
  if (op === '+') return 'bg-green-100 text-green-800'
  if (op === '-') return 'bg-red-100 text-red-800'
  if (op === '=') return 'bg-blue-100 text-blue-800 font-bold'
  return 'bg-slate-100 text-slate-400'
}

function opDisplay(op: Operator): string {
  if (op === '-') return '−'
  if (op === null) return '—'
  return op
}

function propagateSign(parentOp: Operator, childOp: Operator): Operator {
  if (parentOp === '-') {
    if (childOp === '+') return '-'
    if (childOp === '-') return '+'
  }
  return childOp
}

// ── Diff helpers ──────────────────────────────────────────────────────────────

function buildDiffSets(diff: LayoutDiffChange[]) {
  const renames = new Map<number, { oldLabel: string; newLabel: string }>() // keyed by new row_index
  const removedRowIndices = new Set<number>()
  const addedRowIndices = new Set<number>()
  const renamedOldRowIndices = new Set<number>()

  diff.forEach((c) => {
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

// Convert existing template to TRow list, annotating dead/renamed rows
function templateToRows(tmpl: Layer1Template, diff: LayoutDiffChange[]): TRow[] {
  const { renames, removedRowIndices } = buildDiffSets(diff)

  const convert = (r: Layer1TemplateRow, depth = 0): TRow => {
    const sourceRow = r.source_row ?? 0
    const isDead = removedRowIndices.has(sourceRow)
    const renameEntry = renames.get(sourceRow)
    return {
      id: r.id ?? nextId(),
      source_row: sourceRow,
      label: renameEntry ? renameEntry.newLabel : r.label,
      operator: (r.operator ?? null) as Operator,
      expanded: r.expanded ?? false,
      children: (r.children ?? []).map((c) => ({
        id: c.id ?? nextId(),
        source_row: c.source_row ?? 0,
        label: c.label,
        operator: (c.operator ?? '+') as Operator,
      })),
      isDead,
      isRenamed: !!renameEntry,
      pendingRenameFrom: renameEntry ? renameEntry.oldLabel : undefined,
    }
  }

  return (tmpl.rows ?? []).map((r) => convert(r))
}

function rowsToTemplate(rows: TRow[], statementType: string): Layer1Template {
  return {
    meta: { statement_type: statementType, created_at: new Date().toISOString(), schema_version: 2 } as any,
    rows: rows.map((r) => ({
      id: r.id,
      source_row: r.source_row,
      label: r.label,
      operator: r.operator,
      expanded: r.expanded,
      children: r.children.map((c) => ({
        id: c.id,
        source_row: c.source_row,
        label: c.label,
        operator: c.operator,
        children: [],
      })),
    })),
  }
}

// ── Operator Popover ──────────────────────────────────────────────────────────

const OP_OPTIONS: Array<{ op: Operator; label: string; cls: string }> = [
  { op: null, label: 'Blank',         cls: 'bg-slate-100 text-slate-400' },
  { op: '+',  label: 'Add',           cls: 'bg-green-100 text-green-800' },
  { op: '-',  label: 'Subtract',      cls: 'bg-red-100 text-red-800' },
  { op: '=',  label: 'Result / Total',cls: 'bg-blue-100 text-blue-800 font-bold' },
]

function OpPopover({ current, anchorRect, onSelect, onClose }: {
  current: Operator; anchorRect: DOMRect; onSelect: (op: Operator) => void; onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div
      ref={ref}
      className="fixed z-50 bg-white border border-slate-200 rounded-lg shadow-xl p-1.5 flex flex-col gap-0.5 min-w-[152px]"
      style={{ top: anchorRect.bottom + 4, left: anchorRect.left }}
      onMouseLeave={onClose}
    >
      {OP_OPTIONS.map(({ op, label, cls }) => (
        <button
          key={String(op)}
          onClick={() => onSelect(op)}
          className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs hover:bg-slate-50 text-left w-full ${
            current === op ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600'
          }`}
        >
          <span className={`inline-flex items-center justify-center w-7 h-5 rounded-full text-xs font-bold ${cls}`}>
            {opDisplay(op)}
          </span>
          {label}
        </button>
      ))}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function LayoutReconciliation({
  oldLayout,
  newStepCRows,
  diff,
  existingTemplate,
  statementType,
  companyId,
  sessionId,
  reportingPeriod,
  sheetName,
  sharedTab,
  onSaved,
  onCancel,
}: Props) {
  const [rows, setRows] = useState<TRow[]>(() => templateToRows(existingTemplate, diff))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hoveredRow, setHoveredRow] = useState<number | null>(null)
  const [popover, setPopover] = useState<{ outerIdx: number; innerIdx?: number; rect: DOMRect } | null>(null)

  const { renames, removedRowIndices, addedRowIndices, renamedOldRowIndices } = buildDiffSets(diff)

  const dragRef = useRef<{
    type: 'new-source' | 'outer' | 'child'
    sourceRow?: number
    outerIdx?: number
    innerIdx?: number
  } | null>(null)

  const [dropState, setDropState] = useState<{
    zone: 'before' | 'after' | 'onto' | 'rename-confirm' | 'child-before' | 'child-after' | 'end'
    outerIdx?: number
    innerIdx?: number
  } | null>(null)

  const usedSourceRows = new Set(
    rows.flatMap((r) => [r.source_row, ...r.children.map((c) => c.source_row)]),
  )

  // ── Drag handlers ──────────────────────────────────────────────────────────

  function onNewSourceDragStart(e: React.DragEvent, rowIndex: number) {
    dragRef.current = { type: 'new-source', sourceRow: rowIndex }
    e.dataTransfer.effectAllowed = 'copy'
  }

  function onOuterDragStart(e: React.DragEvent, oi: number) {
    e.stopPropagation()
    dragRef.current = { type: 'outer', outerIdx: oi }
    e.dataTransfer.effectAllowed = 'move'
  }

  function onChildDragStart(e: React.DragEvent, oi: number, ci: number) {
    e.stopPropagation()
    dragRef.current = { type: 'child', outerIdx: oi, innerIdx: ci }
    e.dataTransfer.effectAllowed = 'move'
  }

  function onRowDragOver(e: React.DragEvent, oi: number, el: HTMLDivElement) {
    e.preventDefault()
    e.stopPropagation()
    // If dragging a new-source row over a yellow (rename-pending) template row → rename confirm
    if (dragRef.current?.type === 'new-source' && rows[oi]?.isRenamed) {
      setDropState({ zone: 'rename-confirm', outerIdx: oi })
      return
    }
    const rect = el.getBoundingClientRect()
    const y = e.clientY - rect.top
    const EDGE = 8
    if (y < EDGE) setDropState({ zone: 'before', outerIdx: oi })
    else if (y > rect.height - EDGE) setDropState({ zone: 'after', outerIdx: oi })
    else setDropState({ zone: 'onto', outerIdx: oi })
  }

  function onChildDragOver(e: React.DragEvent, oi: number, ci: number, el: HTMLDivElement) {
    e.preventDefault()
    e.stopPropagation()
    const rect = el.getBoundingClientRect()
    const y = e.clientY - rect.top
    if (y < rect.height / 2) setDropState({ zone: 'child-before', outerIdx: oi, innerIdx: ci })
    else setDropState({ zone: 'child-after', outerIdx: oi, innerIdx: ci })
  }

  function commitDrop() {
    const d = dragRef.current
    const ds = dropState
    if (!d || !ds) { resetDrag(); return }

    setRows((prev) => {
      const next = prev.map((r) => ({ ...r, children: [...r.children] }))

      if (d.type === 'new-source' && d.sourceRow != null) {
        const sr = newStepCRows.find((r) => r.row_index === d.sourceRow)
        if (!sr) return prev

        if (ds.zone === 'rename-confirm' && ds.outerIdx != null) {
          // Confirm rename: update label in template row
          next[ds.outerIdx] = {
            ...next[ds.outerIdx],
            source_row: sr.row_index,
            label: sr.label,
            isRenamed: false,
            isDead: false,
            pendingRenameFrom: undefined,
          }
          return next
        }

        if (usedSourceRows.has(sr.row_index)) return prev

        const newOuter: TRow = { id: nextId(), source_row: sr.row_index, label: sr.label, operator: null, expanded: false, children: [] }
        const newChild: TChild = { id: nextId(), source_row: sr.row_index, label: sr.label, operator: '+' }

        if (ds.zone === 'onto' && ds.outerIdx != null) {
          next[ds.outerIdx].children.push(newChild)
          next[ds.outerIdx].expanded = true
        } else if (ds.zone === 'before' && ds.outerIdx != null) {
          next.splice(ds.outerIdx, 0, newOuter)
        } else if (ds.zone === 'after' && ds.outerIdx != null) {
          next.splice(ds.outerIdx + 1, 0, newOuter)
        } else {
          next.push(newOuter)
        }

      } else if (d.type === 'outer' && d.outerIdx != null) {
        const from = d.outerIdx
        if (ds.zone === 'onto' && ds.outerIdx != null && ds.outerIdx !== from) {
          const [moved] = next.splice(from, 1)
          const targetIdx = ds.outerIdx > from ? ds.outerIdx - 1 : ds.outerIdx
          if (moved.children.length > 0) {
            next.splice(targetIdx, 0, ...moved.children.map((c) => ({
              id: c.id, source_row: c.source_row, label: c.label,
              operator: propagateSign(moved.operator, c.operator),
              expanded: false, children: [],
            })))
          }
          const finalIdx = Math.min(targetIdx, next.length - 1)
          next[finalIdx].children.push({ id: moved.id, source_row: moved.source_row, label: moved.label, operator: '+' })
          next[finalIdx].expanded = true
        } else if (ds.zone === 'before' && ds.outerIdx != null) {
          const [moved] = next.splice(from, 1)
          next.splice(ds.outerIdx > from ? ds.outerIdx - 1 : ds.outerIdx, 0, moved)
        } else if (ds.zone === 'after' && ds.outerIdx != null) {
          const [moved] = next.splice(from, 1)
          next.splice(ds.outerIdx >= from ? ds.outerIdx : ds.outerIdx + 1, 0, moved)
        } else if (ds.zone === 'end') {
          const [moved] = next.splice(from, 1)
          next.push(moved)
        }

      } else if (d.type === 'child' && d.outerIdx != null && d.innerIdx != null) {
        const fromOi = d.outerIdx, fromCi = d.innerIdx
        if ((ds.zone === 'child-before' || ds.zone === 'child-after') && ds.outerIdx != null && ds.innerIdx != null) {
          const toOi = ds.outerIdx
          const toCi = ds.zone === 'child-before' ? ds.innerIdx : ds.innerIdx + 1
          if (fromOi === toOi) {
            const [moved] = next[fromOi].children.splice(fromCi, 1)
            next[fromOi].children.splice(toCi > fromCi ? toCi - 1 : toCi, 0, moved)
          } else {
            const [moved] = next[fromOi].children.splice(fromCi, 1)
            next[toOi].children.splice(toCi, 0, moved)
          }
        } else if ((ds.zone === 'before' || ds.zone === 'after' || ds.zone === 'end') && ds.outerIdx != null) {
          const [moved] = next[fromOi].children.splice(fromCi, 1)
          if (next[fromOi].children.length === 0) next[fromOi].expanded = false
          const newOuter: TRow = { id: moved.id, source_row: moved.source_row, label: moved.label, operator: null, expanded: false, children: [] }
          const to = ds.zone === 'end' ? next.length : ds.zone === 'before' ? ds.outerIdx : ds.outerIdx + 1
          next.splice(to, 0, newOuter)
        }
      }

      return next
    })
    resetDrag()
  }

  function resetDrag() {
    dragRef.current = null
    setDropState(null)
  }

  function setOperator(outerIdx: number, op: Operator, innerIdx?: number) {
    setRows((prev) => prev.map((r, oi) => {
      if (oi !== outerIdx) return r
      if (innerIdx == null) return { ...r, operator: op }
      return { ...r, children: r.children.map((c, ci) => ci === innerIdx ? { ...c, operator: op } : c) }
    }))
    setPopover(null)
  }

  function deleteOuter(oi: number) {
    setRows((prev) => {
      const tr = prev[oi]
      const promoted = tr.children.map((c) => ({
        id: c.id, source_row: c.source_row, label: c.label,
        operator: propagateSign(tr.operator, c.operator),
        expanded: false, children: [],
      }))
      const next = [...prev]
      next.splice(oi, 1, ...promoted)
      return next
    })
  }

  function deleteChild(oi: number, ci: number) {
    setRows((prev) => prev.map((r, i) => {
      if (i !== oi) return r
      const children = r.children.filter((_, j) => j !== ci)
      return { ...r, children, expanded: children.length > 0 ? r.expanded : false }
    }))
  }

  function toggleExpand(oi: number) {
    setRows((prev) => prev.map((r, i) => i === oi ? { ...r, expanded: !r.expanded } : r))
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const template = rowsToTemplate(rows, statementType)
      const layoutRows: SourceLayoutRow[] = newStepCRows.map((r) => ({ row_index: r.row_index, label: r.label }))

      // Build retroactive changes
      const templateRenames: Array<{ old_label: string; new_label: string }> = []
      const additions: string[] = []
      const deletions: string[] = []

      rows.forEach((r) => {
        if (r.isDead) deletions.push(r.label)
        if (r.pendingRenameFrom && !r.isDead) {
          templateRenames.push({ old_label: r.pendingRenameFrom, new_label: r.label })
        }
      })

      // Rows in new template that weren't in the old template → additions
      const oldLabels = new Set((existingTemplate.rows ?? []).map((r) => r.label))
      rows.forEach((r) => { if (!oldLabels.has(r.label) && !r.isDead) additions.push(r.label) })

      await Promise.all([
        saveLayer1Template(companyId, statementType, template),
        saveLayout(companyId, statementType, layoutRows),
      ])

      if (templateRenames.length > 0 || additions.length > 0 || deletions.length > 0) {
        applyTemplateChanges(companyId, statementType, templateRenames, additions, deletions).catch(
          (e) => console.warn('[LayoutReconciliation] apply-changes non-fatal:', e),
        )
      }

      const result = await runLayer1Deterministic(
        sessionId, sheetName, statementType, reportingPeriod, companyId, template, sharedTab ?? false,
      )

      onSaved(result)
    } catch (e: any) {
      setError(e.message ?? 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const statementLabel = statementType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  const hasPendingIssues = rows.some((r) => r.isDead)

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-50">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-2.5 flex-shrink-0" style={{ backgroundColor: '#0f172a' }}>
        <div>
          <div className="text-sm font-semibold text-white">{statementLabel} — Layout Changes Detected</div>
          <div className="text-xs text-slate-400">{sheetName} · Review changes before extracting</div>
        </div>
        <div className="flex-1" />
        {error && <span className="text-xs text-red-400 mr-2">{error}</span>}
        {hasPendingIssues && (
          <span className="text-xs text-amber-400 mr-2">Remove or keep red rows before saving</span>
        )}
        <button onClick={onCancel} className="px-3 py-1.5 text-xs text-slate-400 border border-slate-600 rounded-md hover:text-white hover:border-slate-400 transition-colors">
          ← Back
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save Template & Extract'}
        </button>
      </div>

      {/* Legend */}
      <div className="flex-shrink-0 flex items-center gap-4 px-5 py-1.5 bg-slate-800 border-b border-slate-700 text-[10px]">
        <span className="text-slate-400">Changes:</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-400 inline-block"></span><span className="text-slate-300">Added</span></span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block"></span><span className="text-slate-300">Renamed</span></span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block"></span><span className="text-slate-300">Removed</span></span>
        <span className="text-slate-500 ml-2">Drag from middle panel to template: onto yellow = confirm rename · between rows = add as new</span>
      </div>

      {/* 3 panels */}
      <div className="flex flex-1 overflow-hidden justify-center">
        <div className="flex w-full max-w-[1440px] overflow-hidden">

          {/* LEFT — old source (read-only, labels only) */}
          <div className="flex flex-col border-r border-slate-200 bg-white overflow-hidden" style={{ width: '22%' }}>
            <div className="flex-shrink-0 px-3 py-1.5 bg-slate-50 border-b border-slate-200">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Previous Layout</span>
            </div>
            <div className="flex-shrink-0 grid grid-cols-[36px_1fr] px-2 py-1 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              <span></span><span>Label</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {oldLayout.map((r) => {
                const isRemoved = removedRowIndices.has(r.row_index)
                const isRenamed = renamedOldRowIndices.has(r.row_index)
                return (
                  <div
                    key={r.row_index}
                    className={`grid grid-cols-[36px_1fr] items-center px-2 min-h-[26px] border-b border-slate-50 select-none
                      ${isRemoved ? 'bg-red-50' : isRenamed ? 'bg-amber-50' : ''}
                    `}
                  >
                    <span className="text-[10px] text-slate-400 font-mono text-center">{r.row_index}</span>
                    <span className={`text-xs px-1.5 truncate
                      ${isRemoved ? 'text-red-600 line-through' : isRenamed ? 'text-amber-700' : !r.label ? 'text-transparent' : 'text-slate-600'}
                    `}>
                      {r.label || ' '}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* MIDDLE — new source (draggable) */}
          <div className="flex flex-col border-r border-slate-200 bg-white overflow-hidden" style={{ width: '22%' }}>
            <div className="flex-shrink-0 px-3 py-1.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">New Layout</span>
              <span className="text-[10px] bg-slate-200 text-slate-500 rounded-full px-2 py-0.5">
                {diff.filter(c => !c.silent).length} changes
              </span>
            </div>
            <div className="flex-shrink-0 grid grid-cols-[36px_1fr_72px] px-2 py-1 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              <span></span><span>Label</span><span className="text-right pr-1">Value</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {newStepCRows.map((sr) => {
                const isAdded = addedRowIndices.has(sr.row_index)
                const isRenamed = renames.has(sr.row_index)
                const isHovered = hoveredRow === sr.row_index
                const isUsed = usedSourceRows.has(sr.row_index)
                return (
                  <div
                    key={sr.row_index}
                    draggable={!isUsed}
                    onDragStart={isUsed ? undefined : (e) => onNewSourceDragStart(e, sr.row_index)}
                    onMouseEnter={() => setHoveredRow(sr.row_index)}
                    onMouseLeave={() => setHoveredRow(null)}
                    className={`grid grid-cols-[36px_1fr_72px] items-center px-2 min-h-[26px] border-b border-slate-50 select-none transition-colors
                      ${isAdded ? 'bg-green-50' : isRenamed ? 'bg-amber-50' : ''}
                      ${isUsed ? 'opacity-30' : !isAdded && !isRenamed ? 'cursor-grab hover:bg-blue-50' : 'cursor-grab'}
                      ${isHovered ? '!bg-amber-100' : ''}
                    `}
                  >
                    <span className="text-[10px] text-slate-400 font-mono text-center">{sr.row_index}</span>
                    <span className={`text-xs px-1.5 truncate
                      ${isAdded ? 'text-green-700 font-medium' : isRenamed ? 'text-amber-700 font-medium' : !sr.label ? 'text-transparent' : 'text-slate-600'}
                    `}>
                      {sr.label || ' '}
                    </span>
                    <span className={`text-[11px] font-mono text-right pr-1 ${sr.value != null && sr.value < 0 ? 'text-red-500' : 'text-slate-500'}`}>
                      {fmtVal(sr.value)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* RIGHT — template editor */}
          <div
            className="flex flex-col bg-white overflow-hidden"
            style={{ flex: 1 }}
            onDragOver={(e) => { e.preventDefault(); if (!dropState) setDropState({ zone: 'end' }) }}
            onDrop={(e) => { e.preventDefault(); commitDrop() }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropState(null) }}
          >
            <div className="flex-shrink-0 px-4 py-1.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Template</span>
              <span className="text-[10px] bg-slate-200 text-slate-500 rounded-full px-2 py-0.5">{rows.filter(r => !r.isDead).length} active rows</span>
            </div>
            <div className="flex-shrink-0 grid grid-cols-[40px_52px_1fr_26px_26px] px-3 py-1 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              <span>Row</span><span>Op</span><span>Label</span><span></span><span></span>
            </div>

            <div className="flex-1 overflow-y-auto pb-6">
              {rows.map((tr, oi) => {
                const isEq = tr.operator === '='
                const isHovered = hoveredRow === tr.source_row
                const dropBefore = dropState?.zone === 'before' && dropState.outerIdx === oi
                const dropAfter = dropState?.zone === 'after' && dropState.outerIdx === oi
                const dropOnto = dropState?.zone === 'onto' && dropState.outerIdx === oi
                const isRenameTarget = dropState?.zone === 'rename-confirm' && dropState.outerIdx === oi

                return (
                  <div key={tr.id}>
                    <div className={`h-0.5 mx-3 rounded ${dropBefore ? 'bg-blue-500' : 'bg-transparent'}`} />
                    <div
                      draggable={!tr.isDead}
                      onDragStart={tr.isDead ? undefined : (e) => onOuterDragStart(e, oi)}
                      onDragEnd={() => resetDrag()}
                      onDragOver={(e) => { const el = e.currentTarget as HTMLDivElement; onRowDragOver(e, oi, el) }}
                      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); commitDrop() }}
                      onMouseEnter={() => setHoveredRow(tr.source_row)}
                      onMouseLeave={() => setHoveredRow(null)}
                      className={`grid grid-cols-[40px_52px_1fr_26px_26px] items-center px-3 min-h-[30px] border transition-colors
                        ${tr.isDead ? 'bg-red-50 border-red-200' : tr.isRenamed ? 'bg-amber-50 border-amber-200' : isEq ? 'bg-blue-50 border-blue-200 my-0.5' : 'border-transparent hover:bg-slate-50'}
                        ${isHovered ? '!bg-amber-100' : ''}
                        ${dropOnto ? 'outline outline-2 outline-blue-500 rounded' : ''}
                        ${isRenameTarget ? 'outline outline-2 outline-amber-400 rounded' : ''}
                      `}
                    >
                      <span className="text-[10px] text-slate-400 font-mono text-center">{tr.source_row || ''}</span>
                      <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (!tr.isDead) setPopover({ outerIdx: oi, rect: e.currentTarget.getBoundingClientRect() })
                        }}
                        disabled={tr.isDead}
                        className={`inline-flex items-center justify-center w-9 h-5 rounded-full text-xs font-bold transition-opacity ${tr.isDead ? 'opacity-40 cursor-default' : 'hover:opacity-75'} ${opClass(tr.operator)}`}
                      >
                        {opDisplay(tr.operator)}
                      </button>
                      <span className={`text-xs truncate px-1
                        ${tr.isDead ? 'text-red-500 line-through' : tr.isRenamed ? 'text-amber-700 font-medium' : isEq ? 'text-blue-700 font-semibold' : 'text-slate-700'}
                      `}>
                        {tr.label}
                        {tr.isRenamed && !tr.isDead && (
                          <span className="ml-1 text-[10px] text-amber-500 font-normal">(was: {tr.pendingRenameFrom})</span>
                        )}
                      </span>
                      <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); if (tr.children.length > 0) toggleExpand(oi) }}
                        className={`flex items-center justify-center w-5 h-5 text-xs rounded transition-colors text-slate-400
                          ${tr.children.length > 0 ? 'hover:bg-slate-200 cursor-pointer' : 'invisible'}
                        `}
                      >
                        {tr.expanded ? '▾' : '▸'}
                      </button>
                      <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); deleteOuter(oi) }}
                        className="flex items-center justify-center w-5 h-5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded text-base transition-colors"
                      >
                        ×
                      </button>
                    </div>

                    {tr.expanded && tr.children.map((ch, ci) => {
                      const chHovered = hoveredRow === ch.source_row
                      const cdBefore = dropState?.zone === 'child-before' && dropState.outerIdx === oi && dropState.innerIdx === ci
                      const cdAfter = dropState?.zone === 'child-after' && dropState.outerIdx === oi && dropState.innerIdx === ci
                      return (
                        <div key={ch.id}>
                          <div className={`ml-4 h-0.5 mx-3 rounded ${cdBefore ? 'bg-blue-500' : 'bg-transparent'}`} />
                          <div
                            draggable
                            onDragStart={(e) => onChildDragStart(e, oi, ci)}
                            onDragEnd={() => resetDrag()}
                            onDragOver={(e) => { const el = e.currentTarget as HTMLDivElement; onChildDragOver(e, oi, ci, el) }}
                            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); commitDrop() }}
                            onMouseEnter={() => setHoveredRow(ch.source_row)}
                            onMouseLeave={() => setHoveredRow(null)}
                            className={`grid grid-cols-[40px_52px_1fr_26px_26px] items-center pl-8 pr-3 min-h-[26px] border-l-2 border-blue-200 ml-4 bg-blue-50/40 transition-colors ${chHovered ? 'bg-amber-50' : 'hover:bg-blue-50/70'}`}
                          >
                            <span className="text-[10px] text-slate-400 font-mono text-center">{ch.source_row || ''}</span>
                            <button
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation()
                                setPopover({ outerIdx: oi, innerIdx: ci, rect: e.currentTarget.getBoundingClientRect() })
                              }}
                              className={`inline-flex items-center justify-center w-9 h-5 rounded-full text-xs font-bold hover:opacity-75 ${opClass(ch.operator)}`}
                            >
                              {opDisplay(ch.operator)}
                            </button>
                            <span className="text-xs text-slate-600 truncate px-1">{ch.label}</span>
                            <span />
                            <button
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => { e.stopPropagation(); deleteChild(oi, ci) }}
                              className="flex items-center justify-center w-5 h-5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded text-base transition-colors"
                            >
                              ×
                            </button>
                          </div>
                          <div className={`ml-4 h-0.5 mx-3 rounded ${cdAfter ? 'bg-blue-500' : 'bg-transparent'}`} />
                        </div>
                      )
                    })}

                    <div className={`h-0.5 mx-3 rounded ${dropAfter ? 'bg-blue-500' : 'bg-transparent'}`} />
                  </div>
                )
              })}

              {rows.length > 0 && (
                <div
                  className={`mx-4 mt-2 h-10 border-2 border-dashed rounded-lg flex items-center justify-center text-xs transition-colors
                    ${dropState?.zone === 'end' ? 'border-blue-400 bg-blue-50 text-blue-500' : 'border-slate-200 text-slate-400'}
                  `}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropState({ zone: 'end' }) }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); commitDrop() }}
                >
                  + Drop here to add at end
                </div>
              )}
            </div>

            <div className="flex-shrink-0 flex items-center gap-4 px-4 py-1.5 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-400">
              <span><span className="text-red-500 font-medium">{rows.filter(r => r.isDead).length}</span> dead (remove or keep)</span>
              <span><span className="text-amber-600 font-medium">{rows.filter(r => r.isRenamed && !r.isDead).length}</span> renamed</span>
              <span><span className="text-slate-600 font-medium">{rows.filter(r => !r.isDead).length}</span> active</span>
            </div>
          </div>
        </div>
      </div>

      {popover && (
        <OpPopover
          current={popover.innerIdx != null
            ? rows[popover.outerIdx]?.children[popover.innerIdx]?.operator ?? null
            : rows[popover.outerIdx]?.operator ?? null
          }
          anchorRect={popover.rect}
          onSelect={(op) => setOperator(popover.outerIdx, op, popover.innerIdx)}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  )
}
