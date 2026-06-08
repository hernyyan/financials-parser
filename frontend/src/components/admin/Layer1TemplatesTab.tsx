/**
 * Layer1TemplatesTab
 *
 * Admin CompanyDetail sub-panel for viewing and editing Layer 1 templates.
 * Shows IS / BS / CFS as clickable buttons. Clicking one opens a centered
 * modal with the new v2 flat-operator template editor.
 */
import { useEffect, useRef, useState } from 'react'
import type { Layer1Template } from '../../types'
import { getLayer1Template, saveLayer1Template, deleteLayer1Template, applyTemplateChanges } from '../../api/client'
import { API_BASE } from '../../api/client'
import TemplateRightPanel, { type TemplateRightPanelHandle } from '../wizard/TemplateRightPanel'
import { templateToRows, rowsToTemplate, buildChangeSet } from '../wizard/templateRowHelpers'
import type { TNode } from '../wizard/templateRowTypes'
import { EMPTY_SELECTION, type SelectionState } from '../wizard/templateRowTypes'
import { Loader2, CheckCircle2, Trash2, X, FileCode } from 'lucide-react'

interface Props {
  companyId: number
}

type StmtTab = 'income_statement' | 'balance_sheet' | 'cash_flow_statement'

const STMT_SHORT: Record<StmtTab, string> = {
  income_statement: 'IS',
  balance_sheet: 'BS',
  cash_flow_statement: 'CFS',
}

const STMT_FULL: Record<StmtTab, string> = {
  income_statement: 'Income Statement',
  balance_sheet: 'Balance Sheet',
  cash_flow_statement: 'Cash Flow Statement',
}

export default function Layer1TemplatesTab({ companyId }: Props) {
  const [templates, setTemplates] = useState<Partial<Record<StmtTab, Layer1Template | null>>>({})
  const [loading, setLoading] = useState<Partial<Record<StmtTab, boolean>>>({
    income_statement: true, balance_sheet: true, cash_flow_statement: true,
  })

  // Modal state
  const [openStmt, setOpenStmt] = useState<StmtTab | null>(null)
  const [modalMode, setModalMode] = useState<'editor' | 'raw'>('editor')
  const [modalRows, setModalRows] = useState<TNode[]>([])
  const [modalSelection, setModalSelection] = useState<SelectionState>(EMPTY_SELECTION)
  const [hoveredRow, setHoveredRow] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [rawData, setRawData] = useState<any>(null)
  const [rawLoading, setRawLoading] = useState(false)
  const panelRef = useRef<TemplateRightPanelHandle>(null)

  // Load all templates on mount
  useEffect(() => {
    const stmts: StmtTab[] = ['income_statement', 'balance_sheet', 'cash_flow_statement']
    stmts.forEach(stmt => {
      getLayer1Template(companyId, stmt)
        .then(tmpl => setTemplates(prev => ({ ...prev, [stmt]: tmpl })))
        .catch(() => setTemplates(prev => ({ ...prev, [stmt]: null })))
        .finally(() => setLoading(prev => ({ ...prev, [stmt]: false })))
    })
  }, [companyId])

  function openModal(stmt: StmtTab) {
    const tmpl = templates[stmt]
    setOpenStmt(stmt)
    setModalMode('editor')
    setSaveError(null)
    setRawData(null)
    setModalSelection(EMPTY_SELECTION)
    setHoveredRow(null)
    setModalRows(tmpl ? templateToRows(tmpl, [], stmt) : [])
  }

  function closeModal() {
    setOpenStmt(null)
    setModalRows([])
  }

  async function loadRaw(stmt: StmtTab) {
    setRawLoading(true)
    try {
      const res = await fetch(`${API_BASE}/companies/${companyId}/layer1-templates/${stmt}/raw`)
      if (res.ok) setRawData(await res.json())
    } finally {
      setRawLoading(false)
    }
  }

  async function handleSave() {
    if (!openStmt) return
    setSaving(true)
    setSaveError(null)
    try {
      const existingTemplate = templates[openStmt] ?? null
      const tmpl = rowsToTemplate(modalRows, openStmt)

      await saveLayer1Template(companyId, openStmt, tmpl)

      // Apply retroactive changes to company dataset Excel files.
      // Source layout is intentionally NOT updated here — the admin doesn't have
      // access to the uploaded file, so the layout stays from the last user upload.
      const { renames, additions, deletions } = buildChangeSet(existingTemplate, modalRows)
      if (renames.length > 0 || additions.length > 0 || deletions.length > 0) {
        applyTemplateChanges(companyId, openStmt, renames, additions, deletions)
          .catch(e => console.warn('[admin] apply-changes non-fatal:', e))
      }

      setTemplates(prev => ({ ...prev, [openStmt]: tmpl }))
      setTimeout(closeModal, 400)
    } catch (e: any) {
      setSaveError(e.message ?? 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!openStmt) return
    if (!window.confirm(`Delete the ${STMT_FULL[openStmt]} template? This triggers the template editor on next upload.`)) return
    setDeleting(true)
    try {
      await deleteLayer1Template(companyId, openStmt)
      setTemplates(prev => ({ ...prev, [openStmt]: null }))
      closeModal()
    } catch (e: any) {
      setSaveError(e.message ?? 'Delete failed.')
    } finally {
      setDeleting(false)
    }
  }

  const openTemplate = openStmt ? templates[openStmt] : undefined

  return (
    <div className="flex flex-col h-full overflow-hidden p-3 gap-2">
      {/* Statement buttons */}
      <p className="text-[11px] text-muted-foreground">Click a statement to view or edit its template.</p>
      <div className="flex gap-2 flex-wrap">
        {(['income_statement', 'balance_sheet', 'cash_flow_statement'] as StmtTab[]).map(stmt => {
          const isLoading = loading[stmt]
          const hasTmpl = !!templates[stmt]
          return (
            <button
              key={stmt}
              onClick={() => !isLoading && openModal(stmt)}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-[13px] transition-colors hover:bg-gray-50 disabled:opacity-50"
              style={{ fontWeight: 500 }}
            >
              {isLoading
                ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                : hasTmpl
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  : <div className="w-4 h-4 rounded-full border-2 border-gray-300" />
              }
              {STMT_FULL[stmt]}
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${hasTmpl ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
                {isLoading ? '…' : hasTmpl ? 'v2' : 'none'}
              </span>
            </button>
          )
        })}
      </div>

      {/* Modal */}
      {openStmt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50" onClick={closeModal} />

          {/* Modal panel */}
          <div
            className="relative flex flex-col bg-white rounded-xl shadow-2xl overflow-hidden"
            style={{ width: '80vw', height: '85vh', maxWidth: 1200 }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex-shrink-0 flex items-center gap-3 px-5 py-3 border-b border-border" style={{ backgroundColor: '#0f172a' }}>
              <div className="text-sm font-semibold text-white">{STMT_FULL[openStmt]} Template</div>
              <div className="flex items-center gap-1 ml-2">
                {(['editor', 'raw'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => { setModalMode(mode); if (mode === 'raw') loadRaw(openStmt) }}
                    className={`px-2.5 py-1 rounded text-[11px] transition-colors ${modalMode === mode ? 'bg-white text-slate-800' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
                  >
                    {mode === 'editor' ? 'Editor' : 'Raw JSON'}
                  </button>
                ))}
              </div>
              <div className="flex-1" />
              {saveError && <span className="text-xs text-red-400 mr-2">{saveError}</span>}
              {openTemplate && modalMode === 'editor' && (
                <>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] text-red-400 border border-red-800 hover:bg-red-950 disabled:opacity-50 transition-colors"
                    style={{ fontWeight: 500 }}
                  >
                    {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    Delete
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    style={{ fontWeight: 500 }}
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    Save
                  </button>
                </>
              )}
              <button onClick={closeModal} className="ml-1 p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              {modalMode === 'raw' ? (
                <div className="h-full overflow-auto p-4 bg-slate-950 font-mono text-[11px] leading-relaxed">
                  {rawLoading ? (
                    <span className="text-slate-400">Loading…</span>
                  ) : rawData ? (
                    <div className="flex flex-col gap-6">
                      <div>
                        <div className="text-slate-400 mb-1 uppercase tracking-wider text-[10px]">Template — saved {rawData.template?.saved_at ?? 'never'}</div>
                        <pre className="text-green-300 whitespace-pre-wrap break-all">{rawData.template ? JSON.stringify(rawData.template.data, null, 2) : 'null'}</pre>
                      </div>
                      <div>
                        <div className="text-slate-400 mb-1 uppercase tracking-wider text-[10px]">Source Layout — saved {rawData.source_layout?.saved_at ?? 'never'}</div>
                        <pre className="text-cyan-300 whitespace-pre-wrap break-all">{rawData.source_layout ? JSON.stringify(rawData.source_layout.data, null, 2) : 'null'}</pre>
                      </div>
                    </div>
                  ) : (
                    <span className="text-slate-400">No data.</span>
                  )}
                </div>
              ) : !openTemplate ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                  <FileCode className="w-10 h-10 opacity-30" />
                  <p className="text-[13px]">No template saved yet for {STMT_FULL[openStmt]}.</p>
                  <p className="text-[11px] opacity-70">It will be created when the user runs extraction for the first time.</p>
                </div>
              ) : (
                <TemplateRightPanel
                  ref={panelRef}
                  rows={modalRows}
                  onRowsChange={setModalRows}
                  sourceRows={[]}
                  hoveredRow={hoveredRow}
                  onHoverChange={setHoveredRow}
                  selection={modalSelection}
                  onSelectionChange={setModalSelection}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
