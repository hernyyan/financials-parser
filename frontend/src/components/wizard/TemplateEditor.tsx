/**
 * TemplateEditor — tabbed flat-operator template editor for all statement types.
 *
 * Architecture: delegates all row rendering/interaction to TemplateRightPanel
 * (shared with LayoutReconciliation). This file handles the outer shell:
 * tabs, source column, header, save logic.
 */
import { useState } from 'react'
import type { Layer1Response, SourceLayoutRow, TemplateStatementConfig } from '../../types'
import {
  saveLayer1Template,
  saveLayout,
  applyTemplateChanges,
  runLayer1Deterministic,
} from '../../api/client'
import { type TNode, EMPTY_SELECTION, type SelectionState } from './templateRowTypes'
import { templateToRows, rowsToTemplate, buildChangeSet, fmtVal } from './templateRowHelpers'
import TemplateRightPanel from './TemplateRightPanel'

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

// ── Constants ─────────────────────────────────────────────────────────────────

const STMT_LABELS: Record<string, string> = {
  income_statement:    'Income Statement',
  balance_sheet:       'Balance Sheet',
  cash_flow_statement: 'Cash Flow Statement',
}

const STMT_SHORT: Record<string, string> = {
  income_statement:    'IS',
  balance_sheet:       'BS',
  cash_flow_statement: 'CFS',
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TemplateEditor({
  statements,
  companyId,
  sessionId,
  reportingPeriod,
  sharedTab,
  onSaved,
  onCancel,
}: Props) {
  const [activeTab, setActiveTab] = useState(statements[0]?.statementType ?? 'income_statement')
  const [allRows, setAllRows] = useState<Record<string, TNode[]>>(() =>
    Object.fromEntries(
      statements.map(s => [
        s.statementType,
        s.existingTemplate ? templateToRows(s.existingTemplate, s.stepCRows, s.statementType) : [],
      ]),
    ),
  )
  const [hoveredRow, setHoveredRow] = useState<number | null>(null)
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeConfig = statements.find(s => s.statementType === activeTab)
  const activeRows = allRows[activeTab] ?? []
  const activeStepCRows = activeConfig?.stepCRows ?? []

  // ── Save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const results: Record<string, Layer1Response> = {}

      await Promise.all(
        statements.map(async config => {
          const rows = allRows[config.statementType] ?? []
          const template = rowsToTemplate(rows, config.statementType)
          const layoutRows: SourceLayoutRow[] = config.stepCRows.map(r => ({
            row_index: r.row_index,
            label: r.label,
          }))

          const { renames, additions, deletions } = buildChangeSet(config.existingTemplate, rows)

          await Promise.all([
            saveLayer1Template(companyId, config.statementType, template),
            saveLayout(companyId, config.statementType, layoutRows),
          ])

          if (renames.length > 0 || additions.length > 0 || deletions.length > 0) {
            applyTemplateChanges(companyId, config.statementType, renames, additions, deletions)
              .catch(e => console.warn('[TemplateEditor] apply-changes non-fatal:', e))
          }

          const result = await runLayer1Deterministic(
            sessionId,
            config.sheetName,
            config.statementType,
            reportingPeriod,
            companyId,
            template,
            sharedTab ?? false,
          )
          results[config.statementType] = result
        }),
      )

      onSaved(results)
    } catch (e: any) {
      setError(e.message ?? 'Failed to save templates')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

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
          {saving ? 'Saving…' : 'Save All & Extract'}
        </button>
      </div>

      {/* Statement tabs */}
      <div className="flex-shrink-0 flex items-center gap-1 px-4 py-1.5 bg-slate-800 border-b border-slate-700">
        {statements.map(s => (
          <button
            key={s.statementType}
            onClick={() => { setActiveTab(s.statementType); setSelection(EMPTY_SELECTION) }}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              activeTab === s.statementType
                ? 'bg-white text-slate-800'
                : 'text-slate-400 hover:text-white hover:bg-slate-700'
            }`}
          >
            {STMT_SHORT[s.statementType]} — {s.sheetName}
          </button>
        ))}
      </div>

      {/* Two-panel body */}
      {activeConfig && (
        <div className="flex flex-1 overflow-hidden justify-center">
          <div className="flex w-full max-w-[1280px] overflow-hidden">

            {/* LEFT — source column */}
            <div className="flex flex-col border-r border-slate-200 bg-white overflow-hidden" style={{ width: '35%' }}>
              <div className="flex-shrink-0 px-3 py-1.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Source Sheet</span>
              </div>
              <div className="flex-shrink-0 grid grid-cols-[36px_1fr_80px] px-2 py-1 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                <span></span><span>Label</span><span className="text-right pr-1">Value</span>
              </div>
              <div className="flex-1 overflow-y-auto">
                {activeStepCRows.map(sr => {
                  const isEmpty = !sr.label
                  const isTitleRow = Boolean(sr.label) && sr.value === null
                  const isUsedRows = allRows[activeTab] ?? []
                  const usedSet = new Set(
                    isUsedRows.flatMap(r => {
                      const collected: number[] = []
                      const walk = (n: TNode) => { if (n.source_row > 0) collected.push(n.source_row); n.children.forEach(walk) }
                      walk(r)
                      return collected
                    }),
                  )
                  const isUsed = usedSet.has(sr.row_index)
                  const isHovered = !selection.selectedPaths.size && hoveredRow === sr.row_index
                  const isSelected = selection.selectedPaths.has(JSON.stringify([sr.row_index]))  // source selection uses row_index as key
                  const isDraggable = !isEmpty && !isTitleRow && !isUsed
                  return (
                    <div
                      key={sr.row_index}
                      draggable={isDraggable}
                      onDragStart={isDraggable ? e => {
                        e.dataTransfer.setData('sourceRow', String(sr.row_index))
                        e.dataTransfer.effectAllowed = 'copy'
                      } : undefined}
                      onMouseEnter={() => { if (!selection.selectedPaths.size) setHoveredRow(sr.row_index) }}
                      onMouseLeave={() => { if (!selection.selectedPaths.size && hoveredRow === sr.row_index) setHoveredRow(null) }}
                      className={`grid grid-cols-[36px_1fr_80px] items-center px-2 min-h-[26px] border-b border-slate-50 transition-colors
                        ${isDraggable ? 'cursor-grab hover:bg-blue-50' : isUsed ? 'opacity-30' : ''}
                        ${isHovered ? '!bg-yellow-100' : ''}
                        ${isSelected ? '!bg-blue-100 border-l-2 border-blue-500' : ''}
                      `}
                    >
                      <span className="text-[10px] text-slate-400 font-mono text-center">{sr.row_index}</span>
                      <span
                        className={`text-xs truncate ${!sr.label ? 'invisible' : 'text-slate-700'}`}
                        style={{
                          paddingLeft: 6 + (sr.indent ?? 0) * 14,
                          fontWeight: sr.bold ? 700 : 400,
                          fontStyle: sr.italic ? 'italic' : 'normal',
                        }}
                      >
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

            {/* RIGHT — shared template panel */}
            <TemplateRightPanel
              key={activeTab}
              rows={activeRows}
              onRowsChange={rows => setAllRows(prev => ({ ...prev, [activeTab]: rows }))}
              sourceRows={activeStepCRows}
              hoveredRow={hoveredRow}
              onHoverChange={setHoveredRow}
              selection={selection}
              onSelectionChange={setSelection}
              dragOptions={{}}
            />
          </div>
        </div>
      )}
    </div>
  )
}
