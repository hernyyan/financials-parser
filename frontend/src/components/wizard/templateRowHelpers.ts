/**
 * Pure helper functions shared by TemplateEditor and LayoutReconciliation.
 * No React imports — all functions are pure and independently testable.
 */
import type { Layer1Template, Layer1TemplateRow, StepCRow } from '../../types'
import {
  type TNode,
  type Operator,
  type SelectionState,
  MAX_DEPTH,
  cloneTree,
  getNodeByPath,
  getParentArray,
  walkAll,
  walkTree,
  propagateSign as _propagateSign,
  pathKey,
} from './templateRowTypes'

// Re-export propagateSign so callers only need one import
export { propagateSign } from './templateRowTypes'

// ── ID counter ────────────────────────────────────────────────────────────────

let _nextId = 1000
export function nextId(): number { return _nextId++ }

// ── Formatting ────────────────────────────────────────────────────────────────

export function fmtVal(v: number | null): string {
  if (v == null) return ''
  const abs = Math.abs(v).toLocaleString('en-US')
  return v < 0 ? `(${abs})` : abs
}

export function opClass(op: Operator): string {
  if (op === '+') return 'bg-green-100 text-green-800'
  if (op === '-') return 'bg-red-100 text-red-800'
  if (op === '=') return 'bg-blue-100 text-blue-800 font-bold'
  return 'bg-slate-100 text-slate-400'
}

export function opDisplay(op: Operator): string {
  if (op === '-') return '−'
  if (op === null) return '—'
  return op
}

export const OP_OPTIONS: Array<{ op: Operator; label: string; cls: string }> = [
  { op: null, label: 'Blank',          cls: 'bg-slate-100 text-slate-400' },
  { op: '+',  label: 'Add',            cls: 'bg-green-100 text-green-800' },
  { op: '-',  label: 'Subtract',       cls: 'bg-red-100 text-red-800' },
  { op: '=',  label: 'Result / Total', cls: 'bg-blue-100 text-blue-800 font-bold' },
]

// ── Label matching ────────────────────────────────────────────────────────────

/** Build label → [row_index, ...] map. Excludes title rows (label present, value null). */
export function buildLabelLookup(stepCRows: StepCRow[]): Map<string, number[]> {
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

/**
 * Sequential resolver: Nth template row with label X → Nth source row with label X.
 * Falls back to existingSourceRow if already set (> 0).
 */
export function makeSourceRowResolver(labelLookup: Map<string, number[]>) {
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

// ── Template ↔ TNode conversion ───────────────────────────────────────────────

function convertV1Node(
  r: Layer1TemplateRow,
  resolve: (label: string, existing?: number) => number,
  waterfallOps: Map<number, Operator>,
  hasWaterfall: boolean,
  isBsOrCfs: boolean,
): TNode {
  const children = r.children ?? []
  const outerOp: Operator = isBsOrCfs ? null
    : hasWaterfall && r.id != null && waterfallOps.has(r.id) ? waterfallOps.get(r.id)!
    : children.length > 0 ? null : (r.type === 'sum' ? '=' : '+')

  return {
    id: r.id ?? nextId(),
    source_row: resolve(r.label, r.source_row),
    label: r.label,
    operator: outerOp,
    expanded: children.length > 0,
    children: children.map(c => convertV1Node(c, resolve, waterfallOps, false, isBsOrCfs)),
  }
}

export function templateToRows(
  tmpl: Layer1Template,
  stepCRows: StepCRow[],
  statementType?: string,
): TNode[] {
  const labelLookup = buildLabelLookup(stepCRows)
  const resolve = makeSourceRowResolver(labelLookup)

  // Schema v2 — recursive TNode conversion (preserves arbitrary depth)
  if ((tmpl.meta as any)?.schema_version === 2) {
    function convertV2(r: Layer1TemplateRow): TNode {
      return {
        id: r.id ?? nextId(),
        source_row: (r as any).isSectionBreak ? 0 : resolve(r.label, r.source_row),
        label: r.label,
        operator: (r.operator ?? null) as Operator,
        expanded: r.expanded ?? false,
        hidden: (r as any).hidden ?? false,
        isSectionBreak: (r as any).isSectionBreak ?? false,
        children: (r.children ?? []).map(convertV2),
      }
    }
    return (tmpl.rows ?? []).map(convertV2)
  }

  // Schema v1 — SUM/IND with waterfall operators
  const waterfallOps = new Map<number, Operator>()
  ;(tmpl.waterfall ?? []).forEach((w: any) => {
    // null in waterfall = first term (old convention) → convert to '+' (new convention)
    const op = w.operator ?? null
    waterfallOps.set(w.row_id, (op === null ? '+' : op) as Operator)
  })
  const hasWaterfall = waterfallOps.size > 0
  const isBsOrCfs = statementType === 'balance_sheet' || statementType === 'cash_flow_statement'

  return (tmpl.rows ?? []).map(r =>
    convertV1Node(r, resolve, waterfallOps, hasWaterfall, isBsOrCfs),
  )
}

function nodeToTemplateRow(n: TNode): Layer1TemplateRow {
  return {
    id: n.id,
    source_row: n.source_row,
    label: n.label,
    operator: n.operator,
    expanded: n.expanded,
    hidden: n.hidden,
    isSectionBreak: n.isSectionBreak,
    children: n.children.map(nodeToTemplateRow),
  } as unknown as Layer1TemplateRow
}

export function rowsToTemplate(nodes: TNode[], statementType: string): Layer1Template {
  return {
    meta: { statement_type: statementType, created_at: new Date().toISOString(), schema_version: 2 } as any,
    rows: nodes.map(nodeToTemplateRow),
  }
}

// ── Change tracking ───────────────────────────────────────────────────────────

/**
 * Compute renames/additions/deletions between an existing template and the
 * new TNode tree, keyed by source_row for accuracy.
 */
export function buildChangeSet(
  existingTemplate: Layer1Template | null,
  nodes: TNode[],
): {
  renames: Array<{ old_label: string; new_label: string }>
  additions: string[]
  deletions: string[]
} {
  const renames: Array<{ old_label: string; new_label: string }> = []
  const additions: string[] = []
  const deletions: string[] = []

  if (!existingTemplate) {
    for (const [node] of walkTree(nodes)) {
      if (node.source_row > 0) additions.push(node.label)
    }
    return { renames, additions, deletions }
  }

  const oldLabels = new Map<number, string>()
  function walkOld(rows: Layer1TemplateRow[]) {
    rows.forEach(r => {
      if (r.source_row) oldLabels.set(r.source_row, r.label)
      walkOld(r.children ?? [])
    })
  }
  walkOld(existingTemplate.rows ?? [])

  const newLabels = new Map<number, string>()
  for (const [node] of walkTree(nodes)) {
    if (node.source_row > 0) newLabels.set(node.source_row, node.label)
  }

  oldLabels.forEach((oldLabel, srcRow) => {
    const newLabel = newLabels.get(srcRow)
    if (newLabel == null) deletions.push(oldLabel)
    else if (newLabel !== oldLabel) renames.push({ old_label: oldLabel, new_label: newLabel })
  })
  newLabels.forEach((newLabel, srcRow) => {
    if (!oldLabels.has(srcRow)) additions.push(newLabel)
  })

  return { renames, additions, deletions }
}

// ── Decouple (eject children) ─────────────────────────────────────────────────

/**
 * Eject all children of the node at `path` to sit immediately after their
 * parent in the parent's array. Parent remains in place with no children.
 *
 * Sign propagation: each child's operator is recalculated via propagateSign
 * against the parent's operator. Grandchildren keep their operators unchanged
 * (they travel with their immediate parent).
 */
export function decoupleChildren(nodes: TNode[], path: number[]): TNode[] {
  const tree = cloneTree(nodes)
  const target = getNodeByPath(tree, path)
  if (!target || target.children.length === 0) return tree

  const parentArr = getParentArray(tree, path)!
  const targetIdx = path[path.length - 1]

  const ejected = target.children.map(c => ({
    ...c,
    operator: _propagateSign(target.operator, c.operator),
    // grandchildren: keep their subtree intact (don't recurse into sign changes)
  }))

  target.children = []
  target.expanded = false

  // Insert ejected nodes right after the target
  parentArr.splice(targetIdx + 1, 0, ...ejected)

  return tree
}

// ── Selection helpers ─────────────────────────────────────────────────────────

/**
 * Compute the range of paths between anchorPath and clickedPath in full
 * tree order (includes hidden rows inside collapsed parents).
 */
export function computeShiftRange(
  nodes: TNode[],
  anchorKey: string,
  clickedKey: string,
): Set<string> {
  const all = walkAll(nodes)
  const keys = all.map(([, path]) => pathKey(path))
  const anchorIdx = keys.indexOf(anchorKey)
  const clickedIdx = keys.indexOf(clickedKey)
  if (anchorIdx === -1 || clickedIdx === -1) return new Set([clickedKey])
  const lo = Math.min(anchorIdx, clickedIdx)
  const hi = Math.max(anchorIdx, clickedIdx)
  return new Set(keys.slice(lo, hi + 1))
}

/**
 * Handle a click on a node for selection purposes.
 * Returns the updated SelectionState.
 */
export function handleSelectionClick(
  nodes: TNode[],
  clickedPath: number[],
  current: SelectionState,
  event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
): SelectionState {
  const key = pathKey(clickedPath)

  if (event.shiftKey && current.anchorPath) {
    return {
      selectedPaths: computeShiftRange(nodes, current.anchorPath, key),
      anchorPath: current.anchorPath,
    }
  }

  if (event.ctrlKey || event.metaKey) {
    const next = new Set(current.selectedPaths)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return { selectedPaths: next, anchorPath: key }
  }

  // Plain click — single select (toggle off if already the only selected)
  if (current.selectedPaths.size === 1 && current.selectedPaths.has(key)) {
    return { selectedPaths: new Set(), anchorPath: null }
  }
  return { selectedPaths: new Set([key]), anchorPath: key }
}
