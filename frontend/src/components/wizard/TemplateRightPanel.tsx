/**
 * TemplateRightPanel — shared right-panel component for both TemplateEditor
 * and LayoutReconciliation.
 *
 * Features:
 *   - Recursive rendering to arbitrary depth (capped at MAX_DEPTH = 3)
 *   - Multi-select (shift-click range, ctrl/cmd-click toggle)
 *   - Multi-level nesting via drag-onto with depth validation
 *   - Decouple (eject) button on parent rows
 *   - LR-specific coloring via optional rowStatus() prop
 */
import { useState } from 'react'
import { LogOut } from 'lucide-react'
import type { StepCRow } from '../../types'
import {
  type TNode,
  type Operator,
  type SelectionState,
  type DropZone,
  EMPTY_SELECTION,
  getNodeDepth,
  getSubtreeMaxDepth,
  canDropOnto,
  pathKey,
  usedSourceRowSet,
  MAX_DEPTH,
} from './templateRowTypes'
import {
  opClass,
  opDisplay,
  fmtVal,
  decoupleChildren,
  handleSelectionClick,
  propagateSign,
  nextId,
} from './templateRowHelpers'
import OpPopover from './OpPopover'
import { useDragDrop, type UseDragDropOptions } from './useDragDrop'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface TemplateRightPanelProps {
  rows: TNode[]
  onRowsChange: (rows: TNode[]) => void
  sourceRows?: StepCRow[]
  hoveredRow: number | null
  onHoverChange: (row: number | null) => void
  selection: SelectionState
  onSelectionChange: (sel: SelectionState) => void
  dragOptions?: UseDragDropOptions
  /** Return 'dead' | 'renamed' | 'normal' for LR-specific coloring. Default: always 'normal'. */
  rowStatus?: (node: TNode) => 'dead' | 'renamed' | 'normal'
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_ROW_CLS: Record<'dead' | 'renamed' | 'normal', string> = {
  dead:    'bg-red-50 border-red-200',
  renamed: 'bg-amber-50 border-amber-200',
  normal:  'border-transparent hover:bg-slate-50',
}

const STATUS_LABEL_CLS: Record<'dead' | 'renamed' | 'normal', string> = {
  dead:    'text-red-500 line-through',
  renamed: 'text-amber-700 font-medium',
  normal:  'text-slate-700',
}

// ── Status bar ────────────────────────────────────────────────────────────────

function StatusBar({ rows, hasSelection, selectionSize }: { rows: TNode[]; hasSelection: boolean; selectionSize: number }) {
  let eq = 0, plus = 0, minus = 0, blank = 0
  const count = (nodes: TNode[]) => {
    nodes.forEach(n => {
      if (n.operator === '=') eq++
      else if (n.operator === '+') plus++
      else if (n.operator === '-') minus++
      else blank++
      count(n.children)
    })
  }
  count(rows)
  return (
    <div className="flex-shrink-0 flex items-center gap-4 px-4 py-1.5 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-400">
      <span><span className="text-slate-600 font-medium">{eq}</span> result (=)</span>
      <span><span className="text-slate-600 font-medium">{plus}</span> add (+)</span>
      <span><span className="text-slate-600 font-medium">{minus}</span> subtract (−)</span>
      <span><span className="text-slate-600 font-medium">{blank}</span> blank</span>
      {hasSelection && <span className="ml-auto text-blue-600 font-medium">{selectionSize} selected</span>}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TemplateRightPanel({
  rows,
  onRowsChange,
  sourceRows = [],
  hoveredRow,
  onHoverChange,
  selection,
  onSelectionChange,
  dragOptions = {},
  rowStatus = () => 'normal',
}: TemplateRightPanelProps) {
  const [popover, setPopover] = useState<{ path: number[]; rect: DOMRect } | null>(null)

  const {
    dragRef,
    dropZone,
    resetDrag,
    commitDrop,
    onSourceDragStart,
    onNewSourceDragStart,
    onNodeDragStart,
    onNodeDragOver,
    onChildNodeDragOver,
    onPanelDragOver,
    onPanelDragLeave,
  } = useDragDrop(rows, onRowsChange, sourceRows, selection, onSelectionChange, dragOptions)

  const hasSelection = selection.selectedPaths.size > 0
  const usedRows = usedSourceRowSet(rows)

  // ── Operator change ────────────────────────────────────────────────────────

  function setOperatorAtPath(path: number[], op: Operator) {
    function update(nodes: TNode[], remaining: number[]): TNode[] {
      return nodes.map((n, i) => {
        if (i !== remaining[0]) return n
        if (remaining.length === 1) return { ...n, operator: op }
        return { ...n, children: update(n.children, remaining.slice(1)) }
      })
    }
    onRowsChange(update(rows, path))
    setPopover(null)
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  function deleteAtPath(path: number[]) {
    function remove(nodes: TNode[], remaining: number[]): TNode[] {
      if (remaining.length === 1) {
        const node = nodes[remaining[0]]
        // Promote children with sign propagation
        const promoted = (node.children ?? []).map(c => ({
          ...c, operator: propagateSign(node.operator, c.operator),
        }))
        const result = [...nodes]
        result.splice(remaining[0], 1, ...promoted)
        return result
      }
      return nodes.map((n, i) =>
        i === remaining[0] ? { ...n, children: remove(n.children, remaining.slice(1)) } : n,
      )
    }
    onRowsChange(remove(rows, path))
  }

  // ── Toggle expand ──────────────────────────────────────────────────────────

  function toggleExpand(path: number[]) {
    function toggle(nodes: TNode[], remaining: number[]): TNode[] {
      return nodes.map((n, i) => {
        if (i !== remaining[0]) return n
        if (remaining.length === 1) return { ...n, expanded: !n.expanded }
        return { ...n, children: toggle(n.children, remaining.slice(1)) }
      })
    }
    onRowsChange(toggle(rows, path))
  }

  // ── Decouple ───────────────────────────────────────────────────────────────

  function handleDecouple(path: number[]) {
    onRowsChange(decoupleChildren(rows, path))
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  function renderNode(node: TNode, path: number[], depth: number): React.ReactNode {
    const pKey = pathKey(path)
    const status = rowStatus(node)
    const isEq = node.operator === '='
    const isHovered = !hasSelection && hoveredRow === node.source_row
    const isSelected = selection.selectedPaths.has(pKey)
    const dropBefore = dropZone?.zone === 'before' && pathKey(dropZone.path) === pKey
    const dropAfter = dropZone?.zone === 'after' && pathKey(dropZone.path) === pKey
    const dropOnto = dropZone?.zone === 'onto' && pathKey(dropZone.path) === pKey
    const isRenameTarget = dropZone?.zone === 'rename-confirm' && pathKey(dropZone.path) === pKey
    const hasChildren = node.children.length > 0
    const indentPx = 12 + depth * 16

    const baseRowCls = [
      'grid grid-cols-[40px_52px_1fr_26px_26px_26px] items-center pr-3 min-h-[30px] border transition-colors select-none cursor-default',
      isEq && status === 'normal' ? 'bg-blue-50 border-blue-200 my-0.5 font-semibold' : STATUS_ROW_CLS[status],
      isHovered ? '!bg-yellow-100' : '',
      isSelected ? '!bg-blue-100 !border-l-2 !border-blue-500' : '',
      dropOnto ? 'outline outline-2 outline-blue-500 rounded' : '',
      isRenameTarget ? 'outline outline-2 outline-amber-400 rounded' : '',
    ].filter(Boolean).join(' ')

    // Determine if onto is valid for this node (for hover indication)
    const draggingPath = dragRef.current?.type === 'node' ? dragRef.current.path : undefined
    const draggingNode = draggingPath ? rows[draggingPath[0]] : null // simplified depth check
    const draggingSubtreeDepth = draggingNode ? getSubtreeMaxDepth(draggingNode) : 0
    const ontoAllowed = canDropOnto(depth, draggingSubtreeDepth)

    return (
      <div key={node.id}>
        {/* Drop line above */}
        <div className={`h-0.5 rounded mx-3 ${dropBefore ? 'bg-blue-500' : 'bg-transparent'}`} />

        <div
          style={{ paddingLeft: indentPx }}
          className={baseRowCls}
          draggable
          onDragStart={e => { if ((e.target as Element).closest('.no-drag')) { e.preventDefault(); return } onNodeDragStart(e, path) }}
          onDragEnd={resetDrag}
          onDragOver={e => onNodeDragOver(e, path, e.currentTarget as HTMLElement, status === 'renamed')}
          onDrop={e => { e.preventDefault(); e.stopPropagation(); commitDrop() }}
          onMouseEnter={() => { if (!hasSelection) onHoverChange(node.source_row) }}
          onMouseLeave={() => { if (!hasSelection && hoveredRow === node.source_row) onHoverChange(null) }}
          onClick={e => {
            // Selection handling
            onSelectionChange(handleSelectionClick(rows, path, selection, e))
          }}
        >
          {/* Row number */}
          <span className="text-[10px] text-slate-400 font-mono text-center">{node.source_row || ''}</span>

          {/* Operator button */}
          <button
            className={`no-drag inline-flex items-center justify-center w-9 h-5 rounded-full text-xs font-bold transition-opacity hover:opacity-75 ${status === 'dead' ? 'opacity-40 cursor-default' : ''} ${opClass(node.operator)}`}
            disabled={status === 'dead'}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); if (status !== 'dead') setPopover({ path, rect: e.currentTarget.getBoundingClientRect() }) }}
          >
            {opDisplay(node.operator)}
          </button>

          {/* Label */}
          <span className={`text-xs truncate px-1 ${isEq && status === 'normal' ? 'text-blue-700' : STATUS_LABEL_CLS[status]}`}>
            {node.label}
            {status === 'renamed' && node.pendingRenameFrom && (
              <span className="ml-1 text-[10px] text-amber-500 font-normal">(was: {node.pendingRenameFrom})</span>
            )}
          </span>

          {/* Decouple (eject) button — only on parent rows */}
          <button
            className={`no-drag flex items-center justify-center w-5 h-5 text-slate-300 hover:text-orange-500 hover:bg-orange-50 rounded transition-colors ${hasChildren ? '' : 'invisible'}`}
            title="Eject children (decouple from parent)"
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); handleDecouple(path) }}
          >
            <LogOut className="w-3 h-3" />
          </button>

          {/* Expand/collapse chevron */}
          <button
            className={`no-drag flex items-center justify-center w-5 h-5 text-xs rounded text-slate-400 ${hasChildren ? 'hover:bg-slate-200 cursor-pointer' : 'invisible'}`}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); if (hasChildren) toggleExpand(path) }}
          >
            {node.expanded ? '▾' : '▸'}
          </button>

          {/* Delete button */}
          <button
            className="no-drag flex items-center justify-center w-5 h-5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded text-base transition-colors"
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); deleteAtPath(path) }}
          >
            ×
          </button>
        </div>

        {/* Render children recursively when expanded */}
        {node.expanded && hasChildren && node.children.map((child, ci) => {
          const childPath = [...path, ci]
          const childPKey = pathKey(childPath)
          const cdBefore = dropZone?.zone === 'child-before' && pathKey(dropZone.path) === childPKey
          const cdAfter = dropZone?.zone === 'child-after' && pathKey(dropZone.path) === childPKey
          return (
            <div key={child.id}>
              <div className={`h-0.5 rounded mx-3 ${cdBefore ? 'bg-blue-500' : 'bg-transparent'}`} />
              {renderNode(child, childPath, depth + 1)}
              <div className={`h-0.5 rounded mx-3 ${cdAfter ? 'bg-blue-500' : 'bg-transparent'}`} />
            </div>
          )
        })}

        {/* Drop line below */}
        <div className={`h-0.5 rounded mx-3 ${dropAfter ? 'bg-blue-500' : 'bg-transparent'}`} />
      </div>
    )
  }

  return (
    <div
      className="flex flex-col flex-1 overflow-hidden"
      onDragOver={onPanelDragOver}
      onDrop={e => { e.preventDefault(); commitDrop() }}
      onDragLeave={onPanelDragLeave}
      onClick={e => {
        // Click on empty panel area — clear selection
        if ((e.target as Element).classList.contains('rows-list') || e.target === e.currentTarget) {
          onSelectionChange(EMPTY_SELECTION)
        }
      }}
    >
      {/* Column headers */}
      <div className="flex-shrink-0 grid grid-cols-[40px_52px_1fr_26px_26px_26px] px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
        <span>Row</span><span>Op</span><span>Label</span><span></span><span></span><span></span>
      </div>

      <div className="rows-list flex-1 overflow-y-auto pb-6">
        {rows.length === 0 ? (
          <div
            className={`mx-4 mt-5 border-2 border-dashed rounded-lg p-8 text-center text-xs leading-relaxed transition-colors ${dropZone ? 'border-blue-400 bg-blue-50 text-blue-500' : 'border-slate-300 text-slate-400'}`}
            onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
            onDrop={e => { e.preventDefault(); e.stopPropagation(); commitDrop() }}
          >
            Drag rows from the source panel to build your template.<br />
            <span className="opacity-60">Row numbers link back to the source sheet.</span>
          </div>
        ) : (
          rows.map((node, i) => renderNode(node, [i], 0))
        )}

        {rows.length > 0 && (
          <div
            className={`mx-4 mt-2 h-10 border-2 border-dashed rounded-lg flex items-center justify-center text-xs transition-colors ${dropZone?.zone === 'end' ? 'border-blue-400 bg-blue-50 text-blue-500' : 'border-slate-200 text-slate-400'}`}
            onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
            onDrop={e => { e.preventDefault(); e.stopPropagation(); commitDrop({ zone: 'end', path: [] }) }}
          >
            + Drop here to add at end
          </div>
        )}
      </div>

      {/* Status bar */}
      <StatusBar rows={rows} hasSelection={hasSelection} selectionSize={selection.selectedPaths.size} />

      {/* Operator popover */}
      {popover && (() => {
        const node = rows[popover.path[0]]  // simplified — walks only top level for now
        const getOp = (nodes: TNode[], path: number[]): Operator => {
          const n = nodes[path[0]]
          if (!n) return null
          if (path.length === 1) return n.operator
          return getOp(n.children, path.slice(1))
        }
        return (
          <OpPopover
            current={getOp(rows, popover.path)}
            anchorRect={popover.rect}
            onSelect={op => setOperatorAtPath(popover.path, op)}
            onClose={() => setPopover(null)}
          />
        )
      })()}
    </div>
  )
}
