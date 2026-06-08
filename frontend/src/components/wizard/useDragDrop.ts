/**
 * useDragDrop — shared drag-and-drop hook for TemplateRightPanel.
 *
 * Handles:
 *   - Source panel rows dragged into the template
 *   - Template rows reordered within the template (single or multi-select batch)
 *   - Depth validation (MAX_DEPTH = 3)
 *   - Optional rename-confirm drop zone (LayoutReconciliation only)
 */
import { useRef, useState } from 'react'
import type { StepCRow } from '../../types'
import {
  type TNode,
  type Operator,
  type DropZone,
  type DropZoneType,
  type DragState,
  type SelectionState,
  MAX_DEPTH,
  cloneTree,
  getNodeByPath,
  getParentArray,
  getNodeDepth,
  getSubtreeMaxDepth,
  canDropOnto,
  walkAll,
  pathKey,
  parsePath,
  EMPTY_SELECTION,
} from './templateRowTypes'
import { nextId, propagateSign } from './templateRowHelpers'

// ── Options ───────────────────────────────────────────────────────────────────

export interface UseDragDropOptions {
  /** Called when a new-source row is dragged onto a yellow renamed row (LR only). */
  onRenameConfirm?: (targetPath: number[], sourceRow: number) => void
  maxDepth?: number
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useDragDrop(
  rows: TNode[],
  onRowsChange: (rows: TNode[]) => void,
  sourceRows: StepCRow[],
  selection: SelectionState,
  onSelectionChange: (sel: SelectionState) => void,
  options: UseDragDropOptions = {},
) {
  const effectiveMaxDepth = options.maxDepth ?? MAX_DEPTH
  const dragRef = useRef<DragState | null>(null)
  const [dropZone, setDropZone] = useState<DropZone | null>(null)

  // ── Drag start ──────────────────────────────────────────────────────────────

  function onSourceDragStart(e: React.DragEvent, sourceRow: number) {
    dragRef.current = { type: 'source', sourceRow }
    e.dataTransfer.effectAllowed = 'copy'
  }

  function onNewSourceDragStart(e: React.DragEvent, sourceRow: number) {
    dragRef.current = { type: 'new-source', sourceRow }
    e.dataTransfer.effectAllowed = 'copy'
  }

  function onNodeDragStart(e: React.DragEvent, path: number[]) {
    e.stopPropagation()
    dragRef.current = { type: 'node', path }
    e.dataTransfer.effectAllowed = 'move'
  }

  // ── Drag over ───────────────────────────────────────────────────────────────

  function onNodeDragOver(
    e: React.DragEvent,
    path: number[],
    el: HTMLElement,
    nodeIsRenamedTarget?: boolean,
  ) {
    e.preventDefault()
    e.stopPropagation()

    const d = dragRef.current
    if (!d) return

    // LR-specific: new-source dragged onto a renamed (yellow) row → rename confirm
    if (d.type === 'new-source' && nodeIsRenamedTarget) {
      setDropZone({ zone: 'rename-confirm', path })
      return
    }

    // Determine if onto is valid (depth check)
    const targetNode = getNodeByPath(rows, path)
    const targetDepth = getNodeDepth(path)

    let draggingMaxSubtreeDepth = 0
    if (d.type === 'node' && d.path) {
      const draggingNode = getNodeByPath(rows, d.path)
      if (draggingNode) draggingMaxSubtreeDepth = getSubtreeMaxDepth(draggingNode)
    }

    const rect = el.getBoundingClientRect()
    const y = e.clientY - rect.top
    const EDGE = 8

    if (y < EDGE) {
      setDropZone({ zone: 'before', path })
    } else if (y > rect.height - EDGE) {
      setDropZone({ zone: 'after', path })
    } else if (targetNode && canDropOnto(targetDepth, draggingMaxSubtreeDepth)) {
      setDropZone({ zone: 'onto', path })
    } else {
      // Would exceed depth — treat as after
      setDropZone({ zone: 'after', path })
    }
  }

  function onChildNodeDragOver(e: React.DragEvent, path: number[], el: HTMLElement) {
    e.preventDefault()
    e.stopPropagation()
    const rect = el.getBoundingClientRect()
    const y = e.clientY - rect.top
    setDropZone({ zone: y < rect.height / 2 ? 'child-before' : 'child-after', path })
  }

  function onPanelDragOver(e: React.DragEvent) {
    e.preventDefault()
    if (!dropZone) setDropZone({ zone: 'end', path: [] })
  }

  function onPanelDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) resetDrag()
  }

  // ── Commit ──────────────────────────────────────────────────────────────────

  function commitDrop(explicitZone?: DropZone) {
    const d = dragRef.current
    const dz = explicitZone ?? dropZone
    if (!d || !dz) { resetDrag(); return }

    if (d.type === 'source' || d.type === 'new-source') {
      _commitSourceDrop(d, dz)
    } else if (d.type === 'node' && d.path) {
      _commitNodeDrop(d, dz)
    }

    onSelectionChange(EMPTY_SELECTION)
    resetDrag()
  }

  function resetDrag() {
    dragRef.current = null
    setDropZone(null)
  }

  // ── Source drop ─────────────────────────────────────────────────────────────

  function _commitSourceDrop(d: DragState, dz: DropZone) {
    if (d.sourceRow == null) return

    // Rename confirm (LR only)
    if (dz.zone === 'rename-confirm' && options.onRenameConfirm) {
      options.onRenameConfirm(dz.path, d.sourceRow)
      return
    }

    const sr = sourceRows.find(r => r.row_index === d.sourceRow)
    if (!sr) return

    const newNode: TNode = {
      id: nextId(),
      source_row: sr.row_index,
      label: sr.label,
      operator: null,
      expanded: false,
      children: [],
    }

    const tree = cloneTree(rows)
    _insertNode(tree, dz, newNode, '+')
    onRowsChange(tree)
  }

  // ── Node drop (single or batch) ─────────────────────────────────────────────

  function _commitNodeDrop(d: DragState, dz: DropZone) {
    if (!d.path) return

    // Collect all paths to move (selected batch, or just the dragged one)
    const isMulti = selection.selectedPaths.size > 1 && selection.selectedPaths.has(pathKey(d.path))
    const pathsToMove: number[][] = isMulti
      ? _selectedPathsSorted()
      : [d.path]

    // Remove all nodes from tree (back to front to preserve indices)
    let tree = cloneTree(rows)
    const moved: TNode[] = []
    // Sort by document order descending so removals don't shift earlier paths
    const sortedDesc = [...pathsToMove].sort((a, b) => {
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const ai = a[i] ?? -1, bi = b[i] ?? -1
        if (ai !== bi) return bi - ai
      }
      return 0
    })
    for (const path of sortedDesc) {
      const node = getNodeByPath(tree, path)
      if (!node) continue
      const parentArr = getParentArray(tree, path)
      if (!parentArr) continue
      const idx = path[path.length - 1]
      parentArr.splice(idx, 1)
      moved.unshift(node) // re-build in original order
    }

    // Insert at destination
    _insertNodes(tree, dz, moved)
    onRowsChange(tree)
  }

  function _selectedPathsSorted(): number[][] {
    // Sort by document order (ascending)
    const all = walkAll(rows)
    const keySet = selection.selectedPaths
    return all
      .filter(([, path]) => keySet.has(pathKey(path)))
      .map(([, path]) => path)
  }

  // ── Insert helpers ──────────────────────────────────────────────────────────

  function _insertNode(tree: TNode[], dz: DropZone, node: TNode, defaultOp: Operator = null) {
    _insertNodes(tree, dz, [node], defaultOp)
  }

  function _insertNodes(tree: TNode[], dz: DropZone, nodes: TNode[], defaultOp: Operator = null) {
    if (nodes.length === 0) return

    const { zone, path } = dz

    if (zone === 'end' || path.length === 0) {
      tree.push(...nodes.map(n => ({ ...n, operator: n.operator ?? defaultOp })))
      return
    }

    if (zone === 'onto') {
      const target = getNodeByPath(tree, path)
      if (target) {
        target.children.push(
          ...nodes.map(n => ({ ...n, operator: n.operator === null ? '+' : n.operator })),
        )
        target.expanded = true
      }
      return
    }

    if (zone === 'before' || zone === 'after') {
      const parentArr = path.length === 1 ? tree : getNodeByPath(tree, path.slice(0, -1))!.children
      const idx = path[path.length - 1]
      const insertAt = zone === 'before' ? idx : idx + 1
      parentArr.splice(insertAt, 0, ...nodes.map(n => ({ ...n, operator: n.operator ?? defaultOp })))
      return
    }

    // child-before / child-after (same level as existing children)
    if (zone === 'child-before' || zone === 'child-after') {
      const parentPath = path.slice(0, -1)
      const parentArr = parentPath.length === 0 ? tree : getNodeByPath(tree, parentPath)!.children
      const idx = path[path.length - 1]
      const insertAt = zone === 'child-before' ? idx : idx + 1
      parentArr.splice(insertAt, 0, ...nodes.map(n => ({ ...n, operator: n.operator ?? defaultOp })))
    }
  }

  // ── Exposed API ─────────────────────────────────────────────────────────────

  return {
    dragRef,
    dropZone,
    setDropZone,
    resetDrag,
    commitDrop,
    onSourceDragStart,
    onNewSourceDragStart,
    onNodeDragStart,
    onNodeDragOver,
    onChildNodeDragOver,
    onPanelDragOver,
    onPanelDragLeave,
  }
}
