/**
 * Core types and depth utilities shared by TemplateEditor and LayoutReconciliation.
 *
 * TNode is a recursive type — TRow and TChild were merged into one unified type
 * that can appear at any depth. MAX_DEPTH = 3 (root → child → grandchild).
 */

// ── Core types ────────────────────────────────────────────────────────────────

export type Operator = '+' | '-' | '=' | null

export interface TNode {
  id: number
  source_row: number
  label: string
  operator: Operator
  expanded: boolean
  children: TNode[]
  // Reconciliation-only fields (undefined in normal configure editor)
  isDead?: boolean
  isRenamed?: boolean
  pendingRenameFrom?: string
}

export const MAX_DEPTH = 3

// ── Drag / drop types ─────────────────────────────────────────────────────────

export type DropZoneType =
  | 'before'
  | 'after'
  | 'onto'
  | 'child-before'
  | 'child-after'
  | 'rename-confirm'
  | 'end'

export interface DropZone {
  zone: DropZoneType
  /** Index path to the target node: [2] = root row 2, [2,1] = child 1 of root row 2 */
  path: number[]
}

export interface DragState {
  type: 'source' | 'new-source' | 'node'
  /** Row index from the source sheet (for source/new-source drags) */
  sourceRow?: number
  /** Index path of the dragged node in the template tree (for node drags) */
  path?: number[]
}

// ── Selection types ───────────────────────────────────────────────────────────

export interface SelectionState {
  /** Serialised paths of selected nodes, e.g. "[2]", "[2,1]" */
  selectedPaths: Set<string>
  /** Last explicitly clicked path — used as the anchor for shift-range expansion */
  anchorPath: string | null
}

export const EMPTY_SELECTION: SelectionState = {
  selectedPaths: new Set(),
  anchorPath: null,
}

export function pathKey(path: number[]): string {
  return JSON.stringify(path)
}

export function parsePath(key: string): number[] {
  return JSON.parse(key) as number[]
}

// ── Tree walking ──────────────────────────────────────────────────────────────

/** Yield every [node, path, depth] in pre-order (parent before children). */
export function* walkTree(
  nodes: TNode[],
  parentPath: number[] = [],
  depth: number = 0,
): Generator<[TNode, number[], number]> {
  for (let i = 0; i < nodes.length; i++) {
    const path = [...parentPath, i]
    yield [nodes[i], path, depth]
    yield* walkTree(nodes[i].children, path, depth + 1)
  }
}

/** Collect all nodes in tree order as [node, path] pairs, respecting expansion for visible-only walk. */
export function walkVisible(
  nodes: TNode[],
  parentPath: number[] = [],
  depth: number = 0,
): Array<[TNode, number[], number]> {
  const result: Array<[TNode, number[], number]> = []
  for (let i = 0; i < nodes.length; i++) {
    const path = [...parentPath, i]
    result.push([nodes[i], path, depth])
    if (nodes[i].expanded && nodes[i].children.length > 0) {
      result.push(...walkVisible(nodes[i].children, path, depth + 1))
    }
  }
  return result
}

/** All nodes in tree order regardless of expansion (for shift-range that includes hidden rows). */
export function walkAll(
  nodes: TNode[],
  parentPath: number[] = [],
  depth: number = 0,
): Array<[TNode, number[], number]> {
  const result: Array<[TNode, number[], number]> = []
  for (let i = 0; i < nodes.length; i++) {
    const path = [...parentPath, i]
    result.push([nodes[i], path, depth])
    result.push(...walkAll(nodes[i].children, path, depth + 1))
  }
  return result
}

// ── Node access ───────────────────────────────────────────────────────────────

export function getNodeByPath(nodes: TNode[], path: number[]): TNode | null {
  let arr = nodes
  let node: TNode | null = null
  for (const idx of path) {
    node = arr[idx] ?? null
    if (!node) return null
    arr = node.children
  }
  return node
}

export function getParentArray(nodes: TNode[], path: number[]): TNode[] | null {
  if (path.length === 0) return null
  if (path.length === 1) return nodes
  return getNodeByPath(nodes, path.slice(0, -1))?.children ?? null
}

// ── Depth utilities ───────────────────────────────────────────────────────────

/** Depth of a node given its path (0 = root level). */
export function getNodeDepth(path: number[]): number {
  return path.length - 1
}

/** Maximum depth within a subtree (0 = leaf). */
export function getSubtreeMaxDepth(node: TNode): number {
  if (node.children.length === 0) return 0
  return 1 + Math.max(...node.children.map(getSubtreeMaxDepth))
}

/**
 * Whether the dragged subtree can be dropped onto `targetPath` without
 * exceeding MAX_DEPTH.
 *
 * targetDepth:          depth of the node being dropped onto
 * draggingSubtreeDepth: max depth inside the dragged subtree (0 = leaf)
 * After the drop:       dragged node is at targetDepth+1, its deepest
 *                       descendant is at targetDepth+1+draggingSubtreeDepth
 */
export function canDropOnto(targetDepth: number, draggingSubtreeDepth: number): boolean {
  return targetDepth + 1 + draggingSubtreeDepth <= MAX_DEPTH - 1
}

// ── Sign propagation ─────────────────────────────────────────────────────────

export function propagateSign(parentOp: Operator, childOp: Operator): Operator {
  if (parentOp === '-') {
    if (childOp === '+') return '-'
    if (childOp === '-') return '+'
  }
  return childOp
}

// ── Immutable tree mutations ──────────────────────────────────────────────────

/** Deep-clone the tree (necessary before mutations to preserve React immutability). */
export function cloneTree(nodes: TNode[]): TNode[] {
  return nodes.map(n => ({ ...n, children: cloneTree(n.children) }))
}

/** Remove a node at path. Returns [newTree, removedNode]. */
export function removeByPath(nodes: TNode[], path: number[]): [TNode[], TNode] {
  const tree = cloneTree(nodes)
  const parentArr = getParentArray(tree, path)!
  const idx = path[path.length - 1]
  const [removed] = parentArr.splice(idx, 1)
  return [tree, removed]
}

/** Insert nodes at path (insertions happen at the given index in the parent array). */
export function insertAtPath(
  nodes: TNode[],
  parentPath: number[],
  insertIndex: number,
  toInsert: TNode[],
): TNode[] {
  const tree = cloneTree(nodes)
  const arr = parentPath.length === 0 ? tree : getNodeByPath(tree, parentPath)!.children
  arr.splice(insertIndex, 0, ...toInsert)
  return tree
}

// ── Source row set ────────────────────────────────────────────────────────────

/** All source_row values used anywhere in the tree (all depths). */
export function usedSourceRowSet(nodes: TNode[]): Set<number> {
  const s = new Set<number>()
  for (const [node] of walkTree(nodes)) {
    if (node.source_row > 0) s.add(node.source_row)
  }
  return s
}
