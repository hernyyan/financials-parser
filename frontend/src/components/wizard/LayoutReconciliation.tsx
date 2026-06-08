/**
 * LayoutReconciliation — 3-panel UI for resolving layout changes between uploads.
 *
 * Architecture: delegates right-panel rendering/interaction to TemplateRightPanel
 * (shared with TemplateEditor). This file handles the 3-panel layout and the
 * reconciliation-specific state (diff annotations, rename confirm).
 */
import { useState } from 'react'
import type {
  Layer1Template,
  Layer1Response,
  SourceLayoutRow,
  LayoutDiffChange,
  StepCRow,
} from '../../types'
import {
  saveLayer1Template,
  saveLayout,
  applyTemplateChanges,
  runLayer1Deterministic,
} from '../../api/client'
import {
  type TNode,
  type SelectionState,
  EMPTY_SELECTION,
  cloneTree,
  getNodeByPath,
} from './templateRowTypes'
import { templateToRows, rowsToTemplate, fmtVal, buildChangeSet } from './templateRowHelpers'
import TemplateRightPanel from './TemplateRightPanel'

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

// ── Diff helpers ──────────────────────────────────────────────────────────────

function buildDiffSets(diff: LayoutDiffChange[]) {
  const renames = new Map<number, { oldLabel: string; newLabel: string }>()
  const removedRowIndices = new Set<number>()
  const addedRowIndices = new Set<number>()
  const renamedOldRowIndices = new Set<number>()

  diff.forEach(c => {
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

function annotateNodes(
  nodes: TNode[],
  renames: Map<number, { oldLabel: string; newLabel: string }>,
  removedRowIndices: Set<number>,
): TNode[] {
  return nodes.map(n => {
    const isDead = removedRowIndices.has(n.source_row)
    const renameEntry = renames.get(n.source_row)
    return {
      ...n,
      label: renameEntry ? renameEntry.newLabel : n.label,
      isDead,
      isRenamed: !!renameEntry,
      pendingRenameFrom: renameEntry ? renameEntry.oldLabel : undefined,
      children: annotateNodes(n.children, renames, removedRowIndices),
    }
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

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
  const { renames, removedRowIndices, addedRowIndices, renamedOldRowIndices } = buildDiffSets(diff)

  const [rows, setRows] = useState<TNode[]>(() => {
    const base = templateToRows(existingTemplate, newStepCRows, statementType)
    return annotateNodes(base, renames, removedRowIndices)
  })
  const [hoveredRow, setHoveredRow] = useState<number | null>(null)
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasPendingIssues = rows.some(r => r.isDead)

  // ── Rename confirm (drag new-source onto yellow template row) ──────────────

  function handleRenameConfirm(targetPath: number[], sourceRow: number) {
    const sr = newStepCRows.find(r => r.row_index === sourceRow)
    if (!sr) return
    setRows(prev => {
      const tree = cloneTree(prev)
      const target = getNodeByPath(tree, targetPath)
      if (target) {
        target.source_row = sr.row_index
        target.label = sr.label
        target.isRenamed = false
        target.isDead = false
        target.pendingRenameFrom = undefined
      }
      return tree
    })
  }

  // ── Row status for LR-specific coloring ────────────────────────────────────

  function getRowStatus(node: TNode): 'dead' | 'renamed' | 'normal' {
    if (node.isDead) return 'dead'
    if (node.isRenamed) return 'renamed'
    return 'normal'
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const template = rowsToTemplate(rows, statementType)
      const layoutRows: SourceLayoutRow[] = newStepCRows.map(r => ({
        row_index: r.row_index,
        label: r.label,
      }))

      // LR-specific change tracking: derive from row annotations
      const templateRenames: Array<{ old_label: string; new_label: string }> = []
      const additions: string[] = []
      const deletions: string[] = []
      rows.forEach(r => {
        if (r.isDead) deletions.push(r.label)
        else if (r.pendingRenameFrom) templateRenames.push({ old_label: r.pendingRenameFrom, new_label: r.label })
      })
      const oldLabels = new Set((existingTemplate.rows ?? []).map(r => r.label))
      rows.forEach(r => { if (!oldLabels.has(r.label) && !r.isDead) additions.push(r.label) })

      await Promise.all([
        saveLayer1Template(companyId, statementType, template),
        saveLayout(companyId, statementType, layoutRows),
      ])

      if (templateRenames.length > 0 || additions.length > 0 || deletions.length > 0) {
        applyTemplateChanges(companyId, statementType, templateRenames, additions, deletions)
          .catch(e => console.warn('[LayoutReconciliation] apply-changes non-fatal:', e))
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

  // ── Render ─────────────────────────────────────────────────────────────────

  const statementLabel = statementType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

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
        <button onClick={handleSave} disabled={saving} className="px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {saving ? 'Saving…' : 'Save Template & Extract'}
        </button>
      </div>

      {/* Legend */}
      <div className="flex-shrink-0 flex items-center gap-4 px-5 py-1.5 bg-slate-800 border-b border-slate-700 text-[10px]">
        <span className="text-slate-400">Changes:</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-400 inline-block" /><span className="text-slate-300">Added</span></span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /><span className="text-slate-300">Renamed</span></span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block" /><span className="text-slate-300">Removed</span></span>
        <span className="text-slate-500 ml-2">Drag from middle panel onto yellow row = confirm rename · between rows = add as new</span>
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
              {oldLayout.map(r => {
                const isRemoved = removedRowIndices.has(r.row_index)
                const isRenamed = renamedOldRowIndices.has(r.row_index)
                return (
                  <div key={r.row_index} className={`grid grid-cols-[36px_1fr] items-center px-2 min-h-[26px] border-b border-slate-50 select-none ${isRemoved ? 'bg-red-50' : isRenamed ? 'bg-amber-50' : ''}`}>
                    <span className="text-[10px] text-slate-400 font-mono text-center">{r.row_index}</span>
                    <span className={`text-xs px-1.5 truncate ${isRemoved ? 'text-red-600 line-through' : isRenamed ? 'text-amber-700' : !r.label ? 'text-transparent' : 'text-slate-600'}`}>
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
              {newStepCRows.map(sr => {
                const isTitleRow = Boolean(sr.label) && sr.value === null
                const isAdded = addedRowIndices.has(sr.row_index)
                const isRenamed = renames.has(sr.row_index)
                const isHovered = !selection.selectedPaths.size && hoveredRow === sr.row_index
                // A row is "used" if it appears in the template (non-dead)
                const isUsed = rows.some(r => !r.isDead && r.source_row === sr.row_index)
                const isDraggable = !isTitleRow && !isUsed
                return (
                  <div
                    key={sr.row_index}
                    draggable={isDraggable}
                    onDragStart={isDraggable ? e => {
                      e.dataTransfer.setData('newSourceRow', String(sr.row_index))
                      e.dataTransfer.effectAllowed = 'copy'
                    } : undefined}
                    onMouseEnter={() => { if (!selection.selectedPaths.size) setHoveredRow(sr.row_index) }}
                    onMouseLeave={() => { if (!selection.selectedPaths.size && hoveredRow === sr.row_index) setHoveredRow(null) }}
                    className={`grid grid-cols-[36px_1fr_72px] items-center px-2 min-h-[26px] border-b border-slate-50 select-none transition-colors
                      ${isAdded ? 'bg-green-50' : isRenamed ? 'bg-amber-50' : ''}
                      ${isDraggable ? (!isAdded && !isRenamed ? 'cursor-grab hover:bg-blue-50' : 'cursor-grab') : isUsed ? 'opacity-30' : ''}
                      ${isHovered ? '!bg-yellow-100' : ''}
                    `}
                  >
                    <span className="text-[10px] text-slate-400 font-mono text-center">{sr.row_index}</span>
                    <span className={`text-xs px-1.5 truncate ${isAdded ? 'text-green-700 font-medium' : isRenamed ? 'text-amber-700 font-medium' : !sr.label ? 'text-transparent' : 'text-slate-600'}`}>
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

          {/* RIGHT — shared template panel with LR-specific coloring */}
          <TemplateRightPanel
            rows={rows}
            onRowsChange={setRows}
            sourceRows={newStepCRows}
            hoveredRow={hoveredRow}
            onHoverChange={setHoveredRow}
            selection={selection}
            onSelectionChange={setSelection}
            rowStatus={getRowStatus}
            dragOptions={{ onRenameConfirm: handleRenameConfirm }}
          />
        </div>
      </div>
    </div>
  )
}
