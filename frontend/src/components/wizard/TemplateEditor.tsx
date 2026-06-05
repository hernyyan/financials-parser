/**
 * TemplateEditor — tabbed flat-operator template editor for all statement types.
 *
 * Shows one tab per assigned statement (IS / BS / CFS).
 * Each tab has a 2-panel layout: source column (left) + template editor (right).
 *
 * "Save All & Extract" saves all templates, updates layout records, applies
 * retroactive dataset changes, and runs deterministic extraction for each
 * statement before calling onSaved.
 */
import { useState, useRef } from 'react'
import type { Layer1Template, Layer1TemplateRow, Layer1Response, SourceLayoutRow, TemplateStatementConfig, StepCRow } from '../../types'
import {
  saveLayer1Template,
  saveLayout,
  applyTemplateChanges,
  runLayer1Deterministic,
} from '../../api/client'

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

// Build label → [row_index, ...] ordered list for sequential duplicate matching.
// Only includes data rows (value !== null) — title rows (label with no value)
// are excluded so they don't steal label matches from real data rows.
function buildLabelLookup(stepCRows: StepCRow[]): Map<string, number[]> {
  const map = new Map<string, number[]>()
  stepCRows.forEach(sr => {
    if (sr.label && sr.value !== null) {
      const key = sr.label.toLowerCase().trim()
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(sr.row_index)
    }
  })
  return map
}

// Sequential resolver: Nth template row with a given label maps to the Nth
// source row with that label, avoiding duplicate-label collision.
function makeSourceRowResolver(labelLookup: Map<string, number[]>) {
  const usedCounts = new Map<string, number>()
  return (label: string, existingSourceRow?: number): number => {
    if (existingSourceRow && existingSourceRow > 0) return existingSourceRow
    const key = label.toLowerCase().trim()
    const indices = labelLookup.get(key) ?? []
    const count = usedCounts.get(key) ?? 0
    const rowIndex = indices[count] ?? 0
    usedCounts.set(key, count + 1)
    return rowIndex
  }
}

function templateToRows(tmpl: Layer1Template, stepCRows: StepCRow[]): TRow[] {
  const labelLookup = buildLabelLookup(stepCRows)
  const resolve = makeSourceRowResolver(labelLookup)

  // Handle schema v2 (flat operator model — already has children structure)
  if ((tmpl.meta as any)?.schema_version === 2) {
    return (tmpl.rows ?? []).map(r => ({
      id: r.id ?? nextId(),
      source_row: resolve(r.label, r.source_row),
      label: r.label,
      operator: (r.operator ?? null) as Operator,
      expanded: r.expanded ?? false,
      children: (r.children ?? []).map(c => ({
        id: c.id ?? nextId(),
        source_row: resolve(c.label, c.source_row),
        label: c.label,
        operator: (c.operator ?? '+') as Operator,
      })),
    }))
  }

  // Handle schema v1 (SUM/IND — preserve children structure, convert operators)
  return (tmpl.rows ?? []).map(r => {
    const children = (r.children ?? [])
    if (children.length > 0) {
      return {
        id: r.id ?? nextId(),
        source_row: resolve(r.label, r.source_row),
        label: r.label,
        operator: '=' as Operator,
        expanded: true,
        children: children.map(c => ({
          id: c.id ?? nextId(),
          source_row: resolve(c.label, c.source_row),
          label: c.label,
          operator: ((c.children ?? []).length > 0 || c.type === 'sum' ? '=' : '+') as Operator,
        })),
      }
    }
    return {
      id: r.id ?? nextId(),
      source_row: resolve(r.label, r.source_row),
      label: r.label,
      operator: (r.type === 'sum' ? '=' : '+') as Operator,
      expanded: false,
      children: [],
    }
  })
}

function rowsToTemplate(rows: TRow[], statementType: string): Layer1Template {
  return {
    meta: { statement_type: statementType, created_at: new Date().toISOString(), schema_version: 2 } as any,
    rows: rows.map(r => ({
      id: r.id,
      source_row: r.source_row,
      label: r.label,
      operator: r.operator,
      expanded: r.expanded,
      children: r.children.map(c => ({ id: c.id, source_row: c.source_row, label: c.label, operator: c.operator, children: [] })),
    })),
  }
}

// ── Operator Popover ──────────────────────────────────────────────────────────

const OP_OPTIONS: Array<{ op: Operator; label: string; cls: string }> = [
  { op: null, label: 'Blank',          cls: 'bg-slate-100 text-slate-400' },
  { op: '+',  label: 'Add',            cls: 'bg-green-100 text-green-800' },
  { op: '-',  label: 'Subtract',       cls: 'bg-red-100 text-red-800' },
  { op: '=',  label: 'Result / Total', cls: 'bg-blue-100 text-blue-800 font-bold' },
]

function OpPopover({ current, anchorRect, onSelect, onClose }: {
  current: Operator; anchorRect: DOMRect; onSelect: (op: Operator) => void; onClose: () => void
}) {
  return (
    <div
      className="fixed z-50 bg-white border border-slate-200 rounded-lg shadow-xl p-1.5 flex flex-col gap-0.5 min-w-[152px]"
      style={{ top: anchorRect.bottom + 4, left: anchorRect.left }}
      onMouseLeave={onClose}
    >
      {OP_OPTIONS.map(({ op, label, cls }) => (
        <button
          key={String(op)}
          onClick={() => onSelect(op)}
          className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs hover:bg-slate-50 text-left w-full ${current === op ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600'}`}
        >
          <span className={`inline-flex items-center justify-center w-7 h-5 rounded-full text-xs font-bold ${cls}`}>{opDisplay(op)}</span>
          {label}
        </button>
      ))}
    </div>
  )
}

// ── Single-statement panel ────────────────────────────────────────────────────

function StatementPanel({ config, rows, onRowsChange }: {
  config: TemplateStatementConfig
  rows: TRow[]
  onRowsChange: (rows: TRow[]) => void
}) {
  const [hoveredRow, setHoveredRow] = useState<number | null>(null)
  const [popover, setPopover] = useState<{ outerIdx: number; innerIdx?: number; rect: DOMRect } | null>(null)
  const dragRef = useRef<{ type: 'source' | 'outer' | 'child'; sourceRow?: number; outerIdx?: number; innerIdx?: number } | null>(null)
  const [dropState, setDropState] = useState<{ zone: 'before' | 'after' | 'onto' | 'child-before' | 'child-after' | 'end'; outerIdx?: number; innerIdx?: number } | null>(null)

  // Exclude 0 (unresolved source_row) so unmatched template rows don't grey out real source rows
  const usedSourceRows = new Set(
    rows.flatMap(r => [r.source_row, ...r.children.map(c => c.source_row)]).filter(v => v > 0)
  )

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

  function onRowDragOver(e: React.DragEvent, oi: number, el: HTMLDivElement) {
    e.preventDefault(); e.stopPropagation()
    const rect = el.getBoundingClientRect()
    const y = e.clientY - rect.top
    const EDGE = 8
    if (y < EDGE) setDropState({ zone: 'before', outerIdx: oi })
    else if (y > rect.height - EDGE) setDropState({ zone: 'after', outerIdx: oi })
    else setDropState({ zone: 'onto', outerIdx: oi })
  }

  function onChildDragOver(e: React.DragEvent, oi: number, ci: number, el: HTMLDivElement) {
    e.preventDefault(); e.stopPropagation()
    const rect = el.getBoundingClientRect()
    const y = e.clientY - rect.top
    if (y < rect.height / 2) setDropState({ zone: 'child-before', outerIdx: oi, innerIdx: ci })
    else setDropState({ zone: 'child-after', outerIdx: oi, innerIdx: ci })
  }

  function commitDrop() {
    const d = dragRef.current
    const ds = dropState
    if (!d || !ds) { resetDrag(); return }

    const next = rows.map(r => ({ ...r, children: [...r.children] }))
    const usedSet = new Set(next.flatMap(r => [r.source_row, ...r.children.map(c => c.source_row)]))

    if (d.type === 'source' && d.sourceRow != null) {
      if (usedSet.has(d.sourceRow)) { resetDrag(); return }
      const sr = config.stepCRows.find(r => r.row_index === d.sourceRow)
      if (!sr) { resetDrag(); return }
      const newOuter: TRow = { id: nextId(), source_row: sr.row_index, label: sr.label, operator: null, expanded: false, children: [] }
      const newChild: TChild = { id: nextId(), source_row: sr.row_index, label: sr.label, operator: '+' }
      if (ds.zone === 'onto' && ds.outerIdx != null) { next[ds.outerIdx].children.push(newChild); next[ds.outerIdx].expanded = true }
      else if (ds.zone === 'before' && ds.outerIdx != null) next.splice(ds.outerIdx, 0, newOuter)
      else if (ds.zone === 'after' && ds.outerIdx != null) next.splice(ds.outerIdx + 1, 0, newOuter)
      else if (ds.zone === 'child-before' && ds.outerIdx != null && ds.innerIdx != null) next[ds.outerIdx].children.splice(ds.innerIdx, 0, newChild)
      else if (ds.zone === 'child-after' && ds.outerIdx != null && ds.innerIdx != null) next[ds.outerIdx].children.splice(ds.innerIdx + 1, 0, newChild)
      else next.push(newOuter)
    } else if (d.type === 'outer' && d.outerIdx != null) {
      const from = d.outerIdx
      if (ds.zone === 'onto' && ds.outerIdx != null && ds.outerIdx !== from) {
        const [moved] = next.splice(from, 1)
        const tgt = ds.outerIdx > from ? ds.outerIdx - 1 : ds.outerIdx
        if (moved.children.length > 0) next.splice(tgt, 0, ...moved.children.map(c => ({ id: c.id, source_row: c.source_row, label: c.label, operator: propagateSign(moved.operator, c.operator), expanded: false, children: [] })))
        const fi = Math.min(tgt, next.length - 1)
        next[fi].children.push({ id: moved.id, source_row: moved.source_row, label: moved.label, operator: '+' })
        next[fi].expanded = true
      } else if (ds.zone === 'before' && ds.outerIdx != null) { const [m] = next.splice(from, 1); next.splice(ds.outerIdx > from ? ds.outerIdx - 1 : ds.outerIdx, 0, m) }
      else if (ds.zone === 'after' && ds.outerIdx != null) { const [m] = next.splice(from, 1); next.splice(ds.outerIdx >= from ? ds.outerIdx : ds.outerIdx + 1, 0, m) }
      else if (ds.zone === 'end') { const [m] = next.splice(from, 1); next.push(m) }
    } else if (d.type === 'child' && d.outerIdx != null && d.innerIdx != null) {
      const [fOi, fCi] = [d.outerIdx, d.innerIdx]
      if ((ds.zone === 'child-before' || ds.zone === 'child-after') && ds.outerIdx != null && ds.innerIdx != null) {
        const tCi = ds.zone === 'child-before' ? ds.innerIdx : ds.innerIdx + 1
        if (fOi === ds.outerIdx) { const [m] = next[fOi].children.splice(fCi, 1); next[fOi].children.splice(tCi > fCi ? tCi - 1 : tCi, 0, m) }
        else { const [m] = next[fOi].children.splice(fCi, 1); next[ds.outerIdx].children.splice(tCi, 0, m) }
      } else if ((ds.zone === 'before' || ds.zone === 'after' || ds.zone === 'end') && ds.outerIdx != null) {
        const [m] = next[fOi].children.splice(fCi, 1)
        if (next[fOi].children.length === 0) next[fOi].expanded = false
        const newOuter: TRow = { id: m.id, source_row: m.source_row, label: m.label, operator: null, expanded: false, children: [] }
        const to = ds.zone === 'end' ? next.length : ds.zone === 'before' ? ds.outerIdx : ds.outerIdx + 1
        next.splice(to, 0, newOuter)
      }
    }

    onRowsChange(next)
    resetDrag()
  }

  function resetDrag() { dragRef.current = null; setDropState(null) }

  function setOperator(oi: number, op: Operator, ci?: number) {
    onRowsChange(rows.map((r, i) => {
      if (i !== oi) return r
      if (ci == null) return { ...r, operator: op }
      return { ...r, children: r.children.map((c, j) => j === ci ? { ...c, operator: op } : c) }
    }))
    setPopover(null)
  }

  function deleteOuter(oi: number) {
    const tr = rows[oi]
    const promoted = tr.children.map(c => ({ id: c.id, source_row: c.source_row, label: c.label, operator: propagateSign(tr.operator, c.operator), expanded: false, children: [] }))
    const next = [...rows]; next.splice(oi, 1, ...promoted)
    onRowsChange(next)
  }

  function deleteChild(oi: number, ci: number) {
    onRowsChange(rows.map((r, i) => {
      if (i !== oi) return r
      const children = r.children.filter((_, j) => j !== ci)
      return { ...r, children, expanded: children.length > 0 ? r.expanded : false }
    }))
  }

  function toggleExpand(oi: number) {
    onRowsChange(rows.map((r, i) => i === oi ? { ...r, expanded: !r.expanded } : r))
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* LEFT — source column */}
      <div className="flex flex-col border-r border-slate-200 overflow-hidden" style={{ width: '35%' }}>
        <div className="flex-shrink-0 grid grid-cols-[36px_1fr_80px] px-2 py-1.5 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          <span></span><span>Label</span><span className="text-right pr-1">Value</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {config.stepCRows.map(sr => {
            const isEmpty = !sr.label
            const isTitleRow = Boolean(sr.label) && sr.value === null  // label exists but no value
            const isUsed = usedSourceRows.has(sr.row_index)
            const isHovered = hoveredRow === sr.row_index
            const isDraggable = !isEmpty && !isTitleRow && !isUsed
            return (
              <div
                key={sr.row_index}
                draggable={isDraggable}
                onDragStart={isDraggable ? e => onSourceDragStart(e, sr.row_index) : undefined}
                onMouseEnter={() => setHoveredRow(sr.row_index)}
                onMouseLeave={() => setHoveredRow(null)}
                className={`grid grid-cols-[36px_1fr_80px] items-center px-2 min-h-[26px] border-b border-slate-50 select-none transition-colors
                  ${isDraggable ? 'cursor-grab hover:bg-blue-50' : isUsed ? 'opacity-30' : ''}
                  ${isHovered ? '!bg-yellow-200' : ''}
                `}
              >
                <span className="text-[10px] text-slate-400 font-mono text-center">{sr.row_index}</span>
                <span
                  className={`text-xs truncate ${!sr.label ? 'invisible' : 'text-slate-700'}`}
                  style={{ paddingLeft: 6 + (sr.indent ?? 0) * 14, fontWeight: sr.bold ? 700 : 400, fontStyle: sr.italic ? 'italic' : 'normal' }}
                >{sr.label || ' '}</span>
                <span className={`text-[11px] font-mono text-right pr-1 ${sr.value != null && sr.value < 0 ? 'text-red-600' : 'text-slate-500'}`}>{fmtVal(sr.value)}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* RIGHT — template editor */}
      <div
        className="flex flex-col flex-1 overflow-hidden"
        onDragOver={e => { e.preventDefault(); if (!dropState) setDropState({ zone: 'end' }) }}
        onDrop={e => { e.preventDefault(); commitDrop() }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropState(null) }}
      >
        <div className="flex-shrink-0 grid grid-cols-[40px_52px_1fr_26px_26px] px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          <span>Row</span><span>Op</span><span>Label</span><span></span><span></span>
        </div>
        <div className="flex-1 overflow-y-auto pb-6">
          {rows.length === 0 ? (
            <div className={`mx-4 mt-5 border-2 border-dashed rounded-lg p-8 text-center text-xs leading-relaxed transition-colors ${dropState ? 'border-blue-400 bg-blue-50 text-blue-500' : 'border-slate-300 text-slate-400'}`}
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropState({ zone: 'end' }) }}
              onDrop={e => { e.preventDefault(); e.stopPropagation(); commitDrop() }}
            >
              Drag rows from the left panel to build your template.<br />
              <span className="opacity-60">Row numbers link back to the source sheet.</span>
            </div>
          ) : rows.map((tr, oi) => {
            const isEq = tr.operator === '='
            const isHovered = hoveredRow === tr.source_row
            const dropBefore = dropState?.zone === 'before' && dropState.outerIdx === oi
            const dropAfter = dropState?.zone === 'after' && dropState.outerIdx === oi
            const dropOnto = dropState?.zone === 'onto' && dropState.outerIdx === oi
            return (
              <div key={tr.id}>
                <div className={`h-0.5 mx-3 rounded ${dropBefore ? 'bg-blue-500' : 'bg-transparent'}`} />
                <div
                  draggable
                  onDragStart={e => onOuterDragStart(e, oi)}
                  onDragEnd={resetDrag}
                  onDragOver={e => onRowDragOver(e, oi, e.currentTarget as HTMLDivElement)}
                  onDrop={e => { e.preventDefault(); e.stopPropagation(); commitDrop() }}
                  onMouseEnter={() => setHoveredRow(tr.source_row)}
                  onMouseLeave={() => setHoveredRow(null)}
                  className={`grid grid-cols-[40px_52px_1fr_26px_26px] items-center px-3 min-h-[30px] border transition-colors
                    ${isEq ? 'bg-blue-50 border-blue-200 my-0.5 font-semibold' : 'border-transparent hover:bg-slate-50'}
                    ${isHovered ? '!bg-yellow-200' : ''}
                    ${dropOnto ? 'outline outline-2 outline-blue-500 rounded' : ''}
                  `}
                >
                  <span className="text-[10px] text-slate-400 font-mono text-center cursor-grab select-none">{tr.source_row || ''}</span>
                  <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setPopover({ outerIdx: oi, rect: e.currentTarget.getBoundingClientRect() }) }}
                    className={`inline-flex items-center justify-center w-9 h-5 rounded-full text-xs font-bold hover:opacity-75 ${opClass(tr.operator)}`}>{opDisplay(tr.operator)}</button>
                  <span className={`text-xs truncate px-1 ${isEq ? 'text-blue-700' : 'text-slate-700'}`}>{tr.label}</span>
                  <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); if (tr.children.length > 0) toggleExpand(oi) }}
                    className={`flex items-center justify-center w-5 h-5 text-xs rounded text-slate-400 ${tr.children.length > 0 ? 'hover:bg-slate-200 cursor-pointer' : 'invisible'}`}>
                    {tr.expanded ? '▾' : '▸'}
                  </button>
                  <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); deleteOuter(oi) }}
                    className="flex items-center justify-center w-5 h-5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded text-base">×</button>
                </div>

                {tr.expanded && tr.children.map((ch, ci) => {
                  const chHov = hoveredRow === ch.source_row
                  const cdBefore = dropState?.zone === 'child-before' && dropState.outerIdx === oi && dropState.innerIdx === ci
                  const cdAfter = dropState?.zone === 'child-after' && dropState.outerIdx === oi && dropState.innerIdx === ci
                  return (
                    <div key={ch.id}>
                      <div className={`ml-4 h-0.5 mx-3 rounded ${cdBefore ? 'bg-blue-500' : 'bg-transparent'}`} />
                      <div
                        draggable
                        onDragStart={e => onChildDragStart(e, oi, ci)}
                        onDragEnd={resetDrag}
                        onDragOver={e => onChildDragOver(e, oi, ci, e.currentTarget as HTMLDivElement)}
                        onDrop={e => { e.preventDefault(); e.stopPropagation(); commitDrop() }}
                        onMouseEnter={() => setHoveredRow(ch.source_row)}
                        onMouseLeave={() => setHoveredRow(null)}
                        className={`grid grid-cols-[40px_52px_1fr_26px_26px] items-center pl-8 pr-3 min-h-[26px] border-l-2 border-blue-200 ml-4 bg-blue-50/40 transition-colors ${chHov ? '!bg-yellow-200' : 'hover:bg-blue-50/70'}`}
                      >
                        <span className="text-[10px] text-slate-400 font-mono text-center">{ch.source_row || ''}</span>
                        <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setPopover({ outerIdx: oi, innerIdx: ci, rect: e.currentTarget.getBoundingClientRect() }) }}
                          className={`inline-flex items-center justify-center w-9 h-5 rounded-full text-xs font-bold hover:opacity-75 ${opClass(ch.operator)}`}>{opDisplay(ch.operator)}</button>
                        <span className="text-xs text-slate-600 truncate px-1">{ch.label}</span>
                        <span />
                        <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); deleteChild(oi, ci) }}
                          className="flex items-center justify-center w-5 h-5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded text-base">×</button>
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
              className={`mx-4 mt-2 h-10 border-2 border-dashed rounded-lg flex items-center justify-center text-xs transition-colors ${dropState?.zone === 'end' ? 'border-blue-400 bg-blue-50 text-blue-500' : 'border-slate-200 text-slate-400'}`}
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropState({ zone: 'end' }) }}
              onDrop={e => { e.preventDefault(); e.stopPropagation(); commitDrop() }}
            >+ Drop here to add at end</div>
          )}
        </div>

        <div className="flex-shrink-0 flex items-center gap-4 px-4 py-1.5 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-400">
          <span><span className="text-slate-600 font-medium">{rows.filter(r => r.operator === '=').length}</span> result (=)</span>
          <span><span className="text-slate-600 font-medium">{rows.filter(r => r.operator === '+').length}</span> add (+)</span>
          <span><span className="text-slate-600 font-medium">{rows.filter(r => r.operator === '-').length}</span> subtract (−)</span>
          <span><span className="text-slate-600 font-medium">{rows.filter(r => r.operator === null).length}</span> blank</span>
        </div>
      </div>

      {popover && (
        <OpPopover
          current={popover.innerIdx != null ? rows[popover.outerIdx]?.children[popover.innerIdx]?.operator ?? null : rows[popover.outerIdx]?.operator ?? null}
          anchorRect={popover.rect}
          onSelect={op => setOperator(popover.outerIdx, op, popover.innerIdx)}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const STMT_LABELS: Record<string, string> = {
  income_statement: 'Income Statement',
  balance_sheet: 'Balance Sheet',
  cash_flow_statement: 'Cash Flow Statement',
}

const STMT_SHORT: Record<string, string> = {
  income_statement: 'IS',
  balance_sheet: 'BS',
  cash_flow_statement: 'CFS',
}

export default function TemplateEditor({ statements, companyId, sessionId, reportingPeriod, sharedTab, onSaved, onCancel }: Props) {
  const [activeTab, setActiveTab] = useState(statements[0]?.statementType ?? 'income_statement')
  const [allRows, setAllRows] = useState<Record<string, TRow[]>>(() =>
    Object.fromEntries(statements.map(s => [s.statementType, s.existingTemplate ? templateToRows(s.existingTemplate, s.stepCRows) : []]))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setRowsForStmt(stmt: string, rows: TRow[]) {
    setAllRows(prev => ({ ...prev, [stmt]: rows }))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const results: Record<string, Layer1Response> = {}

      await Promise.all(statements.map(async config => {
        const rows = allRows[config.statementType] ?? []
        const template = rowsToTemplate(rows, config.statementType)
        const layoutRows: SourceLayoutRow[] = config.stepCRows.map(r => ({ row_index: r.row_index, label: r.label }))

        // Compute retroactive changes vs existing template
        const renames: Array<{ old_label: string; new_label: string }> = []
        const additions: string[] = []
        const deletions: string[] = []
        if (config.existingTemplate) {
          const oldLabels = new Map<number, string>()
          const walkOld = (rs: Layer1TemplateRow[]) => rs.forEach(r => { if (r.source_row) oldLabels.set(r.source_row, r.label); walkOld(r.children ?? []) })
          walkOld(config.existingTemplate.rows ?? [])
          const newLabels = new Map<number, string>()
          rows.forEach(r => { newLabels.set(r.source_row, r.label); r.children.forEach(c => newLabels.set(c.source_row, c.label)) })
          oldLabels.forEach((oldLabel, srcRow) => {
            const newLabel = newLabels.get(srcRow)
            if (newLabel == null) deletions.push(oldLabel)
            else if (newLabel !== oldLabel) renames.push({ old_label: oldLabel, new_label: newLabel })
          })
          newLabels.forEach((newLabel, srcRow) => { if (!oldLabels.has(srcRow)) additions.push(newLabel) })
        }

        await Promise.all([
          saveLayer1Template(companyId, config.statementType, template),
          saveLayout(companyId, config.statementType, layoutRows),
        ])

        if (renames.length > 0 || additions.length > 0 || deletions.length > 0) {
          applyTemplateChanges(companyId, config.statementType, renames, additions, deletions)
            .catch(e => console.warn('[TemplateEditor] apply-changes non-fatal:', e))
        }

        const result = await runLayer1Deterministic(
          sessionId, config.sheetName, config.statementType, reportingPeriod,
          companyId, template, sharedTab ?? false,
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

  const activeConfig = statements.find(s => s.statementType === activeTab)
  const activeRows = allRows[activeTab] ?? []

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
        <button onClick={onCancel} className="px-3 py-1.5 text-xs text-slate-400 border border-slate-600 rounded-md hover:text-white hover:border-slate-400 transition-colors">← Back</button>
        <button onClick={handleSave} disabled={saving} className="px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {saving ? 'Saving…' : 'Save All & Extract'}
        </button>
      </div>

      {/* Statement tabs */}
      <div className="flex-shrink-0 flex items-center gap-1 px-4 py-1.5 bg-slate-800 border-b border-slate-700">
        {statements.map(s => (
          <button
            key={s.statementType}
            onClick={() => setActiveTab(s.statementType)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${activeTab === s.statementType ? 'bg-white text-slate-800' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
          >
            {STMT_SHORT[s.statementType]} — {s.sheetName}
          </button>
        ))}
      </div>

      {/* Active panel */}
      {activeConfig && (
        <StatementPanel
          key={activeTab}
          config={activeConfig}
          rows={activeRows}
          onRowsChange={rows => setRowsForStmt(activeTab, rows)}
        />
      )}
    </div>
  )
}
