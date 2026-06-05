/**
 * TemplateEditor — 2-panel flat operator template editor for income statements.
 *
 * Left panel: full label+value source column (all rows including blanks), draggable.
 * Right panel: flat list with operators (+/-/=/blank), grouping (children), reorder.
 *
 * On "Save Template & Extract":
 *   1. Saves layout record + template to DB
 *   2. Runs deterministic IS extraction
 *   3. Calls onSaved(result)
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Layer1Template, Layer1TemplateRow, Layer1Response, SourceLayoutRow } from '../../types'
import {
  saveLayer1Template,
  saveLayout,
  applyTemplateChanges,
  runLayer1Deterministic,
} from '../../api/client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StepCRow {
  row_index: number
  label: string
  value: number | null
}

interface Props {
  stepCRows: StepCRow[]
  existingTemplate: Layer1Template | null
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
}

interface TChild {
  id: number
  source_row: number
  label: string
  operator: Operator
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let _nextId = 1000

function nextId(): number {
  return _nextId++
}

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

function templateToRows(tmpl: Layer1Template): TRow[] {
  return (tmpl.rows ?? []).map((r, i) => ({
    id: r.id ?? nextId(),
    source_row: r.source_row ?? 0,
    label: r.label,
    operator: (r.operator ?? null) as Operator,
    expanded: r.expanded ?? false,
    children: (r.children ?? []).map((c) => ({
      id: c.id ?? nextId(),
      source_row: c.source_row ?? 0,
      label: c.label,
      operator: (c.operator ?? '+') as Operator,
    })),
  }))
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

interface OpPopoverProps {
  current: Operator
  anchorRect: DOMRect
  onSelect: (op: Operator) => void
  onClose: () => void
}

const OP_OPTIONS: Array<{ op: Operator; label: string; cls: string }> = [
  { op: null, label: 'Blank', cls: 'bg-slate-100 text-slate-400' },
  { op: '+',  label: 'Add',   cls: 'bg-green-100 text-green-800' },
  { op: '-',  label: 'Subtract', cls: 'bg-red-100 text-red-800' },
  { op: '=',  label: 'Result / Total', cls: 'bg-blue-100 text-blue-800 font-bold' },
]

function OpPopover({ current, anchorRect, onSelect, onClose }: OpPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const top = anchorRect.bottom + 4
  const left = anchorRect.left

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-white border border-slate-200 rounded-lg shadow-xl p-1.5 flex flex-col gap-0.5 min-w-[152px]"
      style={{ top, left }}
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

export default function TemplateEditor({
  stepCRows,
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
  const [rows, setRows] = useState<TRow[]>(() =>
    existingTemplate ? templateToRows(existingTemplate) : [],
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hoveredRow, setHoveredRow] = useState<number | null>(null)

  // Operator popover
  const [popover, setPopover] = useState<{
    outerIdx: number
    innerIdx?: number
    rect: DOMRect
  } | null>(null)

  // Drag state
  const dragRef = useRef<{
    type: 'source' | 'outer' | 'child'
    sourceRow?: number
    outerIdx?: number
    innerIdx?: number
  } | null>(null)

  // Drop state
  const [dropState, setDropState] = useState<{
    zone: 'before' | 'after' | 'onto' | 'child-before' | 'child-after' | 'end'
    outerIdx?: number
    innerIdx?: number
  } | null>(null)

  const usedSourceRows = new Set(
    rows.flatMap((r) => [r.source_row, ...r.children.map((c) => c.source_row)]),
  )

  // ── Drag handlers ──────────────────────────────────────────────────────────

  function onSourceDragStart(e: React.DragEvent, sr: number) {
    dragRef.current = { type: 'source', sourceRow: sr }
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

  function onRowDragOver(e: React.DragEvent, oi: number, rowEl: HTMLDivElement) {
    e.preventDefault()
    e.stopPropagation()
    const rect = rowEl.getBoundingClientRect()
    const y = e.clientY - rect.top
    const EDGE = 8
    if (y < EDGE) setDropState({ zone: 'before', outerIdx: oi })
    else if (y > rect.height - EDGE) setDropState({ zone: 'after', outerIdx: oi })
    else setDropState({ zone: 'onto', outerIdx: oi })
  }

  function onChildDragOver(e: React.DragEvent, oi: number, ci: number, rowEl: HTMLDivElement) {
    e.preventDefault()
    e.stopPropagation()
    const rect = rowEl.getBoundingClientRect()
    const y = e.clientY - rect.top
    if (y < rect.height / 2) setDropState({ zone: 'child-before', outerIdx: oi, innerIdx: ci })
    else setDropState({ zone: 'child-after', outerIdx: oi, innerIdx: ci })
  }

  function commitDrop() {
    const d = dragRef.current
    const ds = dropState
    if (!d || !ds) { resetDrag(); return }

    setRows((prev) => {
      const next = prev.map((r) => ({
        ...r,
        children: [...r.children],
      }))

      const usedSet = new Set(
        next.flatMap((r) => [r.source_row, ...r.children.map((c) => c.source_row)]),
      )

      if (d.type === 'source' && d.sourceRow != null) {
        if (usedSet.has(d.sourceRow)) return prev
        const sr = stepCRows.find((r) => r.row_index === d.sourceRow)
        if (!sr) return prev
        const newChild: TChild = { id: nextId(), source_row: sr.row_index, label: sr.label, operator: '+' }
        const newOuter: TRow = { id: nextId(), source_row: sr.row_index, label: sr.label, operator: null, expanded: false, children: [] }

        if (ds.zone === 'onto' && ds.outerIdx != null) {
          next[ds.outerIdx].children.push(newChild)
          next[ds.outerIdx].expanded = true
        } else if (ds.zone === 'before' && ds.outerIdx != null) {
          next.splice(ds.outerIdx, 0, newOuter)
        } else if (ds.zone === 'after' && ds.outerIdx != null) {
          next.splice(ds.outerIdx + 1, 0, newOuter)
        } else if (ds.zone === 'child-before' && ds.outerIdx != null && ds.innerIdx != null) {
          next[ds.outerIdx].children.splice(ds.innerIdx, 0, newChild)
        } else if (ds.zone === 'child-after' && ds.outerIdx != null && ds.innerIdx != null) {
          next[ds.outerIdx].children.splice(ds.innerIdx + 1, 0, newChild)
        } else {
          next.push(newOuter)
        }

      } else if (d.type === 'outer' && d.outerIdx != null) {
        const from = d.outerIdx
        if (ds.zone === 'onto' && ds.outerIdx != null && ds.outerIdx !== from) {
          const [moved] = next.splice(from, 1)
          const targetIdx = ds.outerIdx > from ? ds.outerIdx - 1 : ds.outerIdx
          const child: TChild = { id: moved.id, source_row: moved.source_row, label: moved.label, operator: '+' }
          // Promote moved's children first
          if (moved.children.length > 0) {
            next.splice(targetIdx, 0, ...moved.children.map((c) => ({
              id: c.id, source_row: c.source_row, label: c.label,
              operator: propagateSign(moved.operator, c.operator),
              expanded: false, children: [],
            })))
          }
          const finalIdx = Math.min(targetIdx, next.length - 1)
          next[finalIdx].children.push(child)
          next[finalIdx].expanded = true
        } else if (ds.zone === 'before' && ds.outerIdx != null) {
          const [moved] = next.splice(from, 1)
          const to = ds.outerIdx > from ? ds.outerIdx - 1 : ds.outerIdx
          next.splice(to, 0, moved)
        } else if (ds.zone === 'after' && ds.outerIdx != null) {
          const [moved] = next.splice(from, 1)
          const to = ds.outerIdx >= from ? ds.outerIdx : ds.outerIdx + 1
          next.splice(to, 0, moved)
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

  // ── Row operations ─────────────────────────────────────────────────────────

  function setOperator(outerIdx: number, op: Operator, innerIdx?: number) {
    setRows((prev) =>
      prev.map((r, oi) => {
        if (oi !== outerIdx) return r
        if (innerIdx == null) return { ...r, operator: op }
        return { ...r, children: r.children.map((c, ci) => ci === innerIdx ? { ...c, operator: op } : c) }
      }),
    )
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
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== oi) return r
        const children = r.children.filter((_, j) => j !== ci)
        return { ...r, children, expanded: children.length > 0 ? r.expanded : false }
      }),
    )
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

      // Detect renames/additions/deletions vs existing template for retroactive dataset update
      const renames: Array<{ old_label: string; new_label: string }> = []
      const additions: string[] = []
      const deletions: string[] = []

      if (existingTemplate) {
        const oldLabels = new Map<number, string>()
        const allOldRows = [...(existingTemplate.rows ?? [])]
        const walkOld = (rs: Layer1TemplateRow[]) => {
          rs.forEach((r) => { if (r.source_row) oldLabels.set(r.source_row, r.label); walkOld(r.children ?? []) })
        }
        walkOld(allOldRows)

        const newLabels = new Map<number, string>()
        rows.forEach((r) => {
          newLabels.set(r.source_row, r.label)
          r.children.forEach((c) => newLabels.set(c.source_row, c.label))
        })

        oldLabels.forEach((oldLabel, srcRow) => {
          const newLabel = newLabels.get(srcRow)
          if (newLabel == null) deletions.push(oldLabel)
          else if (newLabel !== oldLabel) renames.push({ old_label: oldLabel, new_label: newLabel })
        })
        newLabels.forEach((newLabel, srcRow) => {
          if (!oldLabels.has(srcRow)) additions.push(newLabel)
        })
      }

      // Build layout rows from stepCRows for the full source column
      const layoutRows: SourceLayoutRow[] = stepCRows.map((r) => ({
        row_index: r.row_index,
        label: r.label,
      }))

      // Save template + layout (reference data — persists immediately)
      await Promise.all([
        saveLayer1Template(companyId, statementType, template),
        saveLayout(companyId, statementType, layoutRows),
      ])

      // Retroactive dataset updates (fire-and-forget — non-fatal)
      if (renames.length > 0 || additions.length > 0 || deletions.length > 0) {
        applyTemplateChanges(companyId, statementType, renames, additions, deletions).catch(
          (e) => console.warn('[TemplateEditor] apply-changes non-fatal error:', e),
        )
      }

      // Deterministic extraction
      const result = await runLayer1Deterministic(
        sessionId,
        sheetName,
        statementType,
        reportingPeriod,
        companyId,
        template,
        sharedTab ?? false,
      )

      onSaved(result)
    } catch (e: any) {
      setError(e.message ?? 'Failed to save template')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const statementLabel = statementType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-50">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 py-2.5 flex-shrink-0"
        style={{ backgroundColor: '#0f172a' }}
      >
        <div>
          <div className="text-sm font-semibold text-white">{statementLabel} — Template Editor</div>
          <div className="text-xs text-slate-400">{sheetName} · {reportingPeriod}</div>
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
          {saving ? 'Saving…' : 'Save Template & Extract'}
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden justify-center">
        <div className="flex w-full max-w-[1280px] overflow-hidden">

          {/* LEFT — source column */}
          <div className="flex flex-col border-r border-slate-200 bg-white overflow-hidden" style={{ width: '35%' }}>
            <div className="flex-shrink-0 px-3 py-1.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Source Sheet</span>
              <span className="text-[10px] bg-slate-200 text-slate-500 rounded-full px-2 py-0.5">
                {stepCRows.filter(r => !usedSourceRows.has(r.row_index)).length} unused
              </span>
            </div>
            {/* Column headers */}
            <div className="flex-shrink-0 grid grid-cols-[36px_1fr_80px] px-2 py-1 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              <span></span><span>Label</span><span className="text-right pr-1">Value</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {stepCRows.map((sr) => {
                const isEmpty = !sr.label
                const isUsed = usedSourceRows.has(sr.row_index)
                const isHovered = hoveredRow === sr.row_index
                return (
                  <div
                    key={sr.row_index}
                    draggable={!isEmpty && !isUsed}
                    onDragStart={isEmpty || isUsed ? undefined : (e) => onSourceDragStart(e, sr.row_index)}
                    onMouseEnter={() => setHoveredRow(sr.row_index)}
                    onMouseLeave={() => setHoveredRow(null)}
                    className={`grid grid-cols-[36px_1fr_80px] items-center px-2 min-h-[26px] border-b border-slate-50 transition-colors select-none
                      ${isEmpty ? '' : isUsed ? 'opacity-30' : 'cursor-grab hover:bg-blue-50'}
                      ${isHovered ? 'bg-amber-50' : ''}
                    `}
                  >
                    <span className="text-[10px] text-slate-400 font-mono text-center">{sr.row_index}</span>
                    <span className={`text-xs text-slate-700 truncate px-1.5 ${!sr.label ? 'invisible' : ''}`}>
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
              <span className="text-[10px] bg-slate-200 text-slate-500 rounded-full px-2 py-0.5">{rows.length} rows</span>
            </div>
            {/* Column headers */}
            <div className="flex-shrink-0 grid grid-cols-[40px_52px_1fr_26px_26px] px-3 py-1 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              <span>Row</span><span>Op</span><span>Label</span><span></span><span></span>
            </div>

            <div className="flex-1 overflow-y-auto pb-6">
              {rows.length === 0 && (
                <div
                  className={`mx-4 mt-5 border-2 border-dashed rounded-lg p-8 text-center text-xs text-slate-400 leading-relaxed transition-colors
                    ${dropState ? 'border-blue-400 bg-blue-50 text-blue-500' : 'border-slate-300'}
                  `}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropState({ zone: 'end' }) }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); commitDrop() }}
                >
                  Drag rows from the left panel to build your template.<br />
                  <span className="opacity-60">Row numbers link back to the source sheet.</span>
                </div>
              )}

              {rows.map((tr, oi) => {
                const isEq = tr.operator === '='
                const isHovered = hoveredRow === tr.source_row
                const dropBefore = dropState?.zone === 'before' && dropState.outerIdx === oi
                const dropAfter = dropState?.zone === 'after' && dropState.outerIdx === oi
                const dropOnto = dropState?.zone === 'onto' && dropState.outerIdx === oi

                return (
                  <div key={tr.id}>
                    {/* Drop line above */}
                    <div className={`h-0.5 mx-3 rounded transition-colors ${dropBefore ? 'bg-blue-500' : 'bg-transparent'}`} />

                    {/* Outer row */}
                    <div
                      ref={(el) => { if (el) (el as any)._oi = oi }}
                      draggable
                      onDragStart={(e) => onOuterDragStart(e, oi)}
                      onDragEnd={() => resetDrag()}
                      onDragOver={(e) => {
                        const el = e.currentTarget as HTMLDivElement
                        onRowDragOver(e, oi, el)
                      }}
                      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); commitDrop() }}
                      onMouseEnter={() => setHoveredRow(tr.source_row)}
                      onMouseLeave={() => setHoveredRow(null)}
                      className={`grid grid-cols-[40px_52px_1fr_26px_26px] items-center px-3 min-h-[30px] border transition-colors
                        ${isEq ? 'bg-blue-50 border-t-blue-200 border-b-blue-200 border-l-transparent border-r-transparent my-0.5 font-semibold' : 'border-transparent hover:bg-slate-50'}
                        ${isHovered ? '!bg-amber-50' : ''}
                        ${dropOnto ? 'outline outline-2 outline-blue-500 rounded' : ''}
                      `}
                    >
                      <span className="text-[10px] text-slate-400 font-mono text-center cursor-grab select-none">
                        {tr.source_row || ''}
                      </span>
                      <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation()
                          setPopover({ outerIdx: oi, rect: e.currentTarget.getBoundingClientRect() })
                        }}
                        className={`inline-flex items-center justify-center w-9 h-5 rounded-full text-xs font-bold transition-opacity hover:opacity-75 ${opClass(tr.operator)}`}
                      >
                        {opDisplay(tr.operator)}
                      </button>
                      <span className={`text-xs truncate px-1 ${isEq ? 'text-blue-700' : 'text-slate-700'}`}>
                        {tr.label}
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

                    {/* Children */}
                    {tr.expanded && tr.children.map((ch, ci) => {
                      const chHovered = hoveredRow === ch.source_row
                      const cdBefore = dropState?.zone === 'child-before' && dropState.outerIdx === oi && dropState.innerIdx === ci
                      const cdAfter = dropState?.zone === 'child-after' && dropState.outerIdx === oi && dropState.innerIdx === ci

                      return (
                        <div key={ch.id}>
                          <div className={`ml-4 h-0.5 mx-3 rounded transition-colors ${cdBefore ? 'bg-blue-500' : 'bg-transparent'}`} />
                          <div
                            draggable
                            onDragStart={(e) => onChildDragStart(e, oi, ci)}
                            onDragEnd={() => resetDrag()}
                            onDragOver={(e) => {
                              const el = e.currentTarget as HTMLDivElement
                              onChildDragOver(e, oi, ci, el)
                            }}
                            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); commitDrop() }}
                            onMouseEnter={() => setHoveredRow(ch.source_row)}
                            onMouseLeave={() => setHoveredRow(null)}
                            className={`grid grid-cols-[40px_52px_1fr_26px_26px] items-center pl-8 pr-3 min-h-[26px] border-l-2 border-blue-200 ml-4 bg-blue-50/40 transition-colors
                              ${chHovered ? 'bg-amber-50' : 'hover:bg-blue-50/70'}
                            `}
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
                          <div className={`ml-4 h-0.5 mx-3 rounded transition-colors ${cdAfter ? 'bg-blue-500' : 'bg-transparent'}`} />
                        </div>
                      )
                    })}

                    {/* Drop line below */}
                    <div className={`h-0.5 mx-3 rounded transition-colors ${dropAfter ? 'bg-blue-500' : 'bg-transparent'}`} />
                  </div>
                )
              })}

              {/* End drop zone */}
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

            {/* Status bar */}
            <div className="flex-shrink-0 flex items-center gap-4 px-4 py-1.5 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-400">
              <span><span className="text-slate-600 font-medium">{rows.filter(r => r.operator === '=').length}</span> result (=)</span>
              <span><span className="text-slate-600 font-medium">{rows.filter(r => r.operator === '+').length}</span> add (+)</span>
              <span><span className="text-slate-600 font-medium">{rows.filter(r => r.operator === '-').length}</span> subtract (−)</span>
              <span><span className="text-slate-600 font-medium">{rows.filter(r => r.operator === null).length}</span> blank</span>
            </div>
          </div>
        </div>
      </div>

      {/* Operator popover */}
      {popover && (
        <OpPopover
          current={
            popover.innerIdx != null
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
