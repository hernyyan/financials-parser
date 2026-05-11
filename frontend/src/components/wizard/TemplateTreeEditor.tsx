/**
 * TemplateTreeEditor
 *
 * Shared tree editor for Layer 1 templates. Used by:
 *   - TemplateReview    (first-upload IS review)
 *   - Admin L1 Templates tab (full editing for all statement types)
 *
 * Props:
 *   rows         — current mutable rows state
 *   waterfall    — current mutable waterfall state (null for BS/CFS)
 *   statementType
 *   onChange(rows, waterfall) — called whenever the user edits anything
 */
import { useState, type ReactNode } from 'react'
import type { Layer1TemplateRow, WaterfallStep } from '../../types'
import { X } from 'lucide-react'
import WaterfallEditor from './WaterfallEditor'

// ── Badge colours ────────────────────────────────────────────────────────────

const BADGE: Record<string, string> = {
  sum:        'bg-blue-100 text-blue-700 border-blue-200',
  individual: 'bg-gray-100 text-gray-600 border-gray-200',
}

const BADGE_LABEL: Record<string, string> = {
  sum: 'SUM', individual: 'IND',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatVal(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  if (v === 0) return '—'
  const abs = Math.abs(v)
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  return v < 0 ? `(${s})` : s
}

function collectAllIds(rows: Layer1TemplateRow[]): Set<number> {
  const ids = new Set<number>()
  function walk(rs: Layer1TemplateRow[]) {
    for (const r of rs) { ids.add(r.id); walk(r.children) }
  }
  walk(rows)
  return ids
}

/** Flatten rows to a map id→row for quick lookup */
function buildMap(rows: Layer1TemplateRow[]): Map<number, Layer1TemplateRow> {
  const map = new Map<number, Layer1TemplateRow>()
  function walk(rs: Layer1TemplateRow[]) {
    for (const r of rs) { map.set(r.id, r); walk(r.children) }
  }
  walk(rows)
  return map
}

/** Deep clone rows array */
function cloneRows(rows: Layer1TemplateRow[]): Layer1TemplateRow[] {
  return rows.map(r => ({ ...r, children: cloneRows(r.children) }))
}

/** Mutate: change the type of node with given id */
function setNodeType(rows: Layer1TemplateRow[], id: number, type: Layer1TemplateRow['type']): Layer1TemplateRow[] {
  return rows.map(r => {
    if (r.id === id) return { ...r, type, children: type === 'individual' ? [] : r.children }
    return { ...r, children: setNodeType(r.children, id, type) }
  })
}

/** Mutate: set children of node with given id */
function setNodeChildren(rows: Layer1TemplateRow[], id: number, children: Layer1TemplateRow[]): Layer1TemplateRow[] {
  return rows.map(r => {
    if (r.id === id) return { ...r, children }
    return { ...r, children: setNodeChildren(r.children, id, children) }
  })
}

// ── Types ────────────────────────────────────────────────────────────────────

interface Props {
  rows: Layer1TemplateRow[]
  waterfall: WaterfallStep[] | null   // null = not IS
  statementType: string
  onChange: (rows: Layer1TemplateRow[], waterfall: WaterfallStep[] | null) => void
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TemplateTreeEditor({ rows, waterfall, statementType, onChange }: Props) {
  const isIS = statementType === 'income_statement'

  // Multi-select mode for promoting IND → SUM
  const [promoteMode, setPromoteMode] = useState<{
    parentId: number
    selected: Set<number>
  } | null>(null)

  const [notification, setNotification] = useState<string | null>(null)

  function notify(msg: string) {
    setNotification(msg)
    setTimeout(() => setNotification(null), 3500)
  }

  // ── Badge click handlers ────────────────────────────────────────────────

  function handleBadgeClick(row: Layer1TemplateRow, depth: number) {
    if (promoteMode) return  // locked during promote mode

    const cur = row.type
    const nodeMap = buildMap(rows)

    if (cur === 'sum') {
      // SUM → IND: clear children, remove from waterfall
      const hadChildren = row.children.length > 0
      const newRows = setNodeType(cloneRows(rows), row.id, 'individual')
      let newWaterfall = waterfall
      if (isIS && waterfall) {
        newWaterfall = waterfall.filter(w => w.row_id !== row.id)
      }
      onChange(newRows, newWaterfall)
      if (hadChildren) {
        notify(`"${row.label}" demoted to IND — ${row.children.length} child(ren) removed from tree and waterfall.`)
      }
      return
    }

    if (cur === 'individual') {
      // IND → SUM: enter multi-select mode
      setPromoteMode({ parentId: row.id, selected: new Set() })
      return
    }
  }

  // ── Promote mode ────────────────────────────────────────────────────────

  function togglePromoteChild(id: number) {
    if (!promoteMode) return
    const next = new Set(promoteMode.selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPromoteMode({ ...promoteMode, selected: next })
  }

  function confirmPromote() {
    if (!promoteMode) return
    const { parentId, selected } = promoteMode

    // Find all selected rows (they must be siblings or top-level)
    const newRows = cloneRows(rows)
    const nodeMap = buildMap(newRows)
    const parent = nodeMap.get(parentId)
    if (!parent) { setPromoteMode(null); return }

    // Collect selected nodes from the flat top-level list
    const selectedNodes = [...selected]
      .map(id => nodeMap.get(id))
      .filter((r): r is Layer1TemplateRow => !!r)

    const updatedParent: Layer1TemplateRow = {
      ...parent,
      type: 'sum',
      children: selectedNodes,
    }

    // Set updated rows
    function replaceNode(rs: Layer1TemplateRow[]): Layer1TemplateRow[] {
      return rs.map(r => {
        if (r.id === parentId) return updatedParent
        // Remove selected children from their current positions (they moved into parent)
        return { ...r, children: replaceNode(r.children.filter(c => !selected.has(c.id))) }
      }).filter(r => !selected.has(r.id) || r.id === parentId)
    }

    const finalRows = replaceNode(newRows)

    // Add to waterfall if IS
    let newWaterfall = waterfall
    if (isIS && waterfall) {
      newWaterfall = [...waterfall, { row_id: parentId, label: parent.label, operator: '+' }]
    }

    onChange(finalRows, newWaterfall)
    setPromoteMode(null)
    notify(`"${parent.label}" promoted to SUM with ${selected.size} child(ren).`)
  }

  // ── Row renderer ────────────────────────────────────────────────────────
  // Sum rows are rendered AFTER their children (financial statement convention:
  // individual line items first, then the total at the bottom of the group).

  function renderRow(row: Layer1TemplateRow, depth: number): ReactNode {
    const isInPromoteMode = !!promoteMode && promoteMode.parentId !== row.id
    const isPromoteParent = promoteMode?.parentId === row.id
    const isSelected = promoteMode?.selected.has(row.id)
    const isSelectable = promoteMode && !isPromoteParent && row.type === 'individual' && depth === 0

    const rowCls = [
      'flex items-center gap-2 px-2 py-1 border-b border-gray-100 text-[12px]',
      isPromoteParent ? 'bg-blue-50 ring-1 ring-blue-200' : '',
      isSelectable ? 'cursor-pointer hover:bg-blue-50' : '',
      isSelected ? 'bg-blue-100' : '',
      isInPromoteMode && !isSelectable ? 'opacity-40 pointer-events-none' : '',
    ].join(' ')

    const rowEl = (
      <div
        className={rowCls}
        style={{ paddingLeft: 8 + depth * 20 }}
        onClick={isSelectable ? () => togglePromoteChild(row.id) : undefined}
      >
        {/* Type badge */}
        <button
          className={`shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-mono transition-colors ${BADGE[row.type]} ${promoteMode ? 'pointer-events-none' : 'hover:opacity-70'}`}
          style={{ fontWeight: 600 }}
          onClick={(e) => { e.stopPropagation(); handleBadgeClick(row, depth) }}
          title={`Click to change type (current: ${row.type})`}
        >
          {BADGE_LABEL[row.type]}
        </button>

        {/* Label */}
        <span
          className="flex-1 truncate"
          style={{ fontWeight: row.type === 'sum' ? 600 : 400 }}
        >
          {row.label}
        </span>

        {/* Value */}
        <span className={`font-mono text-[11px] shrink-0 ${row.value && row.value < 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
          {formatVal(row.value)}
        </span>

        {/* Validation flag */}
        {row.validated === false && (
          <span className="shrink-0 px-1 py-0.5 rounded bg-amber-50 text-amber-600 text-[10px] border border-amber-200" title={row.validation_note}>!</span>
        )}

        {/* Select checkbox (promote mode) */}
        {isSelectable && (
          <span className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center ${isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`}>
            {isSelected && <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-white fill-current"><path d="M2 6l3 3 5-5"/></svg>}
          </span>
        )}
      </div>
    )

    // Sum with children: children first, then the sum row at the bottom
    if (row.type === 'sum' && row.children.length > 0) {
      return (
        <div key={row.id}>
          {renderRows(row.children, depth + 1)}
          {rowEl}
        </div>
      )
    }

    // All other types: row first, then children (if any)
    return (
      <div key={row.id}>
        {rowEl}
        {row.children.length > 0 && renderRows(row.children, depth + 1)}
      </div>
    )
  }

  function renderRows(rs: Layer1TemplateRow[], depth = 0): ReactNode {
    return rs.map(row => renderRow(row, depth))
  }

  const nodeMap = buildMap(rows)

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Notification banner */}
      {notification && (
        <div className="shrink-0 px-3 py-2 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-800 flex items-center justify-between">
          <span>{notification}</span>
          <button onClick={() => setNotification(null)}><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* Promote-mode banner */}
      {promoteMode && (
        <div className="shrink-0 px-3 py-2 bg-blue-50 border-b border-blue-200 text-[11px] text-blue-800 flex items-center justify-between gap-2">
          <span>Select rows to become children of <strong>"{nodeMap.get(promoteMode.parentId)?.label}"</strong>. Click a row to toggle.</span>
          <div className="flex gap-1.5">
            <button
              onClick={confirmPromote}
              disabled={promoteMode.selected.size === 0}
              className="px-2 py-0.5 rounded bg-blue-600 text-white text-[11px] disabled:opacity-40"
              style={{ fontWeight: 500 }}
            >
              Confirm ({promoteMode.selected.size})
            </button>
            <button onClick={() => setPromoteMode(null)} className="px-2 py-0.5 rounded border border-blue-300 text-blue-700 text-[11px]">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Tree */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Column headers */}
        <div className="flex items-center gap-2 px-2 py-1 bg-gray-50 border-b border-gray-200 text-[11px] text-muted-foreground shrink-0 sticky top-0">
          <span className="w-8 shrink-0">Type</span>
          <span className="flex-1">Label</span>
          <span className="font-mono w-20 text-right shrink-0">Value</span>
        </div>
        {renderRows(rows)}
      </div>

      {/* Waterfall editor (IS only) */}
      {isIS && waterfall && (
        <WaterfallEditor
          waterfall={waterfall}
          rows={rows}
          onChange={(newWaterfall) => onChange(rows, newWaterfall)}
        />
      )}
    </div>
  )
}
