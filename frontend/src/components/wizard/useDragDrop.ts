/**
 * useDragDrop — shared drag-and-drop hook for TemplateRightPanel.
 *
 * Bug fixes vs previous version:
 *  - Path shifting: drop target is captured by node ID before removals, then
 *    re-located after removals. This prevents the "wrong parent / rows vanish"
 *    bug caused by using stale path indices after node removal.
 *  - Source multi-drag: when multiple source rows are selected and one is dragged,
 *    all selected source rows are inserted together.
 */
import { useRef, useState } from 'react'
import type { StepCRow } from '../../types'
import {
  type TNode,
  type Operator,
  type DropZone,
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
  EMPTY_SELECTION,
} from './templateRowTypes'
import { nextId } from './templateRowHelpers'

// ── Options ───────────────────────────────────────────────────────────────────

export interface UseDragDropOptions {
  onRenameConfirm?: (targetPath: number[], sourceRow: number) => void
  maxDepth?: number
}

// ── ID-based tree helpers (path-independent after removals) ───────────────────

function findNodeById(nodes: TNode[], id: number): TNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    const found = findNodeById(n.children, id)
    if (found) return found
  }
  return null
}

function findParentArrayAndIdx(nodes: TNode[], id: number): [TNode[], number] | null {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return [nodes, i]
    const found = findParentArrayAndIdx(nodes[i].children, id)
    if (found) return found
  }
  return null
}

function buildUsedSet(nodes: TNode[]): Set<number> {
  const s = new Set<number>()
  const walk = (arr: TNode[]) => arr.forEach(n => { if (n.source_row > 0) s.add(n.source_row); walk(n.children) })
  walk(nodes)
  return s
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

  function onNodeDragOver(e: React.DragEvent, path: number[], el: HTMLElement, nodeIsRenamedTarget?: boolean) {
    e.preventDefault()
    e.stopPropagation()

    const d = dragRef.current
    if (!d) return

    if (d.type === 'new-source' && nodeIsRenamedTarget) {
      setDropZone({ zone: 'rename-confirm', path })
      return
    }

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

    if (dz.zone === 'rename-confirm' && options.onRenameConfirm) {
      options.onRenameConfirm(dz.path, d.sourceRow)
      return
    }

    // Multi-select: add ALL selected source rows if dragged row is in selection
    const selectedSrcRows = [...selection.selectedPaths]
      .filter(k => k.startsWith('src:'))
      .map(k => parseInt(k.slice(4), 10))
      .filter(ri => !isNaN(ri))

    const rowsToAdd: number[] = selectedSrcRows.length > 1 && selectedSrcRows.includes(d.sourceRow)
      ? selectedSrcRows
      : [d.sourceRow]

    const tree = cloneTree(rows)
    // Prevent the same row from being added twice in a single batch drag,
    // but allow rows already in the template (multi-use is intentional).
    const addedInThisBatch = new Set<number>()
    const nodesToAdd: TNode[] = []

    for (const rowIndex of rowsToAdd) {
      if (addedInThisBatch.has(rowIndex)) continue
      const sr = sourceRows.find(r => r.row_index === rowIndex)
      if (!sr) continue
      nodesToAdd.push({ id: nextId(), source_row: sr.row_index, label: sr.label, operator: null, expanded: false, children: [] })
      addedInThisBatch.add(rowIndex)
    }

    if (nodesToAdd.length > 0) {
      _insertNodes(tree, dz, nodesToAdd, '+')
    }
    onRowsChange(tree)
  }

  // ── Node drop (single or batch) ─────────────────────────────────────────────

  function _commitNodeDrop(d: DragState, dz: DropZone) {
    if (!d.path) return

    const isMulti = selection.selectedPaths.size > 1 && selection.selectedPaths.has(pathKey(d.path))
    const pathsToMove: number[][] = isMulti ? _selectedPathsSorted() : [d.path]

    const tree = cloneTree(rows)

    // ── CRITICAL: capture drop target by node ID BEFORE any removals.
    // After removing nodes the path indices shift, so dz.path would point
    // to the wrong node. Using the ID lets us re-locate the target after removal.
    const dropTargetId: number | null = dz.zone !== 'end' && dz.path.length > 0
      ? (getNodeByPath(tree, dz.path)?.id ?? null)
      : null

    // Remove selected nodes in reverse document order to preserve remaining indices
    const moved: TNode[] = []
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
      parentArr.splice(path[path.length - 1], 1)
      moved.unshift(node)
    }

    // Insert at destination using ID-based lookup (immune to index shifting)
    _insertNodesById(tree, dz.zone, dropTargetId, moved)
    onRowsChange(tree)
  }

  function _selectedPathsSorted(): number[][] {
    const all = walkAll(rows)
    const keySet = selection.selectedPaths
    return all
      .filter(([, path]) => keySet.has(pathKey(path)))
      .map(([, path]) => path)
  }

  // ── ID-based insert (used after removals) ─────────────────────────────────────

  function _insertNodesById(tree: TNode[], zone: string, targetId: number | null, nodes: TNode[]) {
    if (nodes.length === 0) return

    if (zone === 'end' || targetId === null) {
      tree.push(...nodes)
      return
    }

    if (zone === 'onto') {
      const target = findNodeById(tree, targetId)
      if (target) {
        target.children.push(...nodes.map(n => ({ ...n, operator: n.operator === null ? '+' : n.operator })))
        target.expanded = true
      } else {
        tree.push(...nodes) // fallback
      }
      return
    }

    // before / after / child-before / child-after — find by ID then insert at position
    const found = findParentArrayAndIdx(tree, targetId)
    if (!found) { tree.push(...nodes); return }

    const [parentArr, idx] = found
    if (zone === 'before' || zone === 'child-before') {
      parentArr.splice(idx, 0, ...nodes)
    } else {
      parentArr.splice(idx + 1, 0, ...nodes)
    }
  }

  // ── Path-based insert (used for source drops where no prior removal) ──────────

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
        target.children.push(...nodes.map(n => ({ ...n, operator: n.operator === null ? (defaultOp ?? '+') : n.operator })))
        target.expanded = true
      }
      return
    }

    if (zone === 'before' || zone === 'after') {
      const parentArr = path.length === 1 ? tree : getNodeByPath(tree, path.slice(0, -1))!.children
      const insertAt = zone === 'before' ? path[path.length - 1] : path[path.length - 1] + 1
      parentArr.splice(insertAt, 0, ...nodes.map(n => ({ ...n, operator: n.operator ?? defaultOp })))
      return
    }

    if (zone === 'child-before' || zone === 'child-after') {
      const parentPath = path.slice(0, -1)
      const parentArr = parentPath.length === 0 ? tree : getNodeByPath(tree, parentPath)!.children
      const insertAt = zone === 'child-before' ? path[path.length - 1] : path[path.length - 1] + 1
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
