/**
 * Layer1TemplatesTab
 *
 * Admin CompanyDetail sub-panel for viewing and editing Layer 1 templates.
 * Shows IS / BS / CFS sub-tabs, each with a full TemplateTreeEditor.
 */
import { useEffect, useState } from 'react'
import type { Layer1Template, Layer1TemplateRow, WaterfallStep } from '../../types'
import { getLayer1Template, saveLayer1Template, deleteLayer1Template } from '../../api/client'
import { API_BASE } from '../../api/client'
import TemplateTreeEditor from '../wizard/TemplateTreeEditor'
import { Loader2, CheckCircle2, Trash2 } from 'lucide-react'

interface Props {
  companyId: number
}

type StmtTab = 'income_statement' | 'balance_sheet' | 'cash_flow_statement'

const STMT_LABELS: Record<StmtTab, string> = {
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
  const [activeStmt, setActiveStmt] = useState<StmtTab>('income_statement')
  const [labelColInput, setLabelColInput] = useState('')
  const [labelColSaving, setLabelColSaving] = useState(false)
  const [labelColSaved, setLabelColSaved] = useState(false)

  async function saveLabelColOverride() {
    setLabelColSaving(true)
    setLabelColSaved(false)
    try {
      const val = labelColInput.trim() === '' ? null : parseInt(labelColInput, 10)
      await fetch(`${API_BASE}/admin/companies/${companyId}/label-column`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label_col: val }),
      })
      setLabelColSaved(true)
      setTimeout(() => setLabelColSaved(false), 2000)
    } finally {
      setLabelColSaving(false)
    }
  }

  // Per-statement template state
  const [templates, setTemplates] = useState<Partial<Record<StmtTab, Layer1Template>>>({})
  const [rows, setRows] = useState<Partial<Record<StmtTab, Layer1TemplateRow[]>>>({})
  const [waterfalls, setWaterfalls] = useState<Partial<Record<StmtTab, WaterfallStep[] | null>>>({})
  const [loading, setLoading] = useState<Partial<Record<StmtTab, boolean>>>({})
  const [saving, setSaving] = useState<Partial<Record<StmtTab, boolean>>>({})
  const [deleting, setDeleting] = useState<Partial<Record<StmtTab, boolean>>>({})
  const [errors, setErrors] = useState<Partial<Record<StmtTab, string>>>({})
  const [saved, setSaved] = useState<Partial<Record<StmtTab, boolean>>>({})

  // Load all 3 on mount
  useEffect(() => {
    const stmts: StmtTab[] = ['income_statement', 'balance_sheet', 'cash_flow_statement']
    setLoading({ income_statement: true, balance_sheet: true, cash_flow_statement: true })

    stmts.forEach(stmt => {
      getLayer1Template(companyId, stmt)
        .then(tmpl => {
          if (tmpl) {
            setTemplates(prev => ({ ...prev, [stmt]: tmpl }))
            setRows(prev => ({ ...prev, [stmt]: tmpl.rows }))
            setWaterfalls(prev => ({
              ...prev,
              [stmt]: stmt === 'income_statement' ? (tmpl.waterfall ?? []) : null,
            }))
          }
        })
        .catch(() => {})
        .finally(() => setLoading(prev => ({ ...prev, [stmt]: false })))
    })
  }, [companyId])

  function handleChange(stmt: StmtTab, newRows: Layer1TemplateRow[], newWaterfall: WaterfallStep[] | null) {
    setRows(prev => ({ ...prev, [stmt]: newRows }))
    setWaterfalls(prev => ({ ...prev, [stmt]: newWaterfall }))
    setSaved(prev => ({ ...prev, [stmt]: false }))
  }

  async function handleDelete(stmt: StmtTab) {
    if (!window.confirm(`Delete the ${STMT_FULL[stmt]} template for this company? This cannot be undone and will trigger the new template editor on the next upload.`)) return
    setDeleting(prev => ({ ...prev, [stmt]: true }))
    setErrors(prev => ({ ...prev, [stmt]: undefined }))
    try {
      await deleteLayer1Template(companyId, stmt)
      setTemplates(prev => { const n = { ...prev }; delete n[stmt]; return n })
      setRows(prev => { const n = { ...prev }; delete n[stmt]; return n })
      setWaterfalls(prev => { const n = { ...prev }; delete n[stmt]; return n })
    } catch (err) {
      setErrors(prev => ({ ...prev, [stmt]: err instanceof Error ? err.message : 'Delete failed.' }))
    } finally {
      setDeleting(prev => ({ ...prev, [stmt]: false }))
    }
  }

  async function handleSave(stmt: StmtTab) {
    const stmtRows = rows[stmt]
    if (!stmtRows) return
    setSaving(prev => ({ ...prev, [stmt]: true }))
    setErrors(prev => ({ ...prev, [stmt]: undefined }))
    try {
      const tmpl: Layer1Template = {
        meta: { statement_type: stmt, created_at: new Date().toISOString() },
        rows: stmtRows,
        ...(stmt === 'income_statement' && waterfalls[stmt] !== null
          ? { waterfall: waterfalls[stmt] ?? [] }
          : {}),
      }
      await saveLayer1Template(companyId, stmt, tmpl)
      setSaved(prev => ({ ...prev, [stmt]: true }))
      setTimeout(() => setSaved(prev => ({ ...prev, [stmt]: false })), 2000)
    } catch (err) {
      setErrors(prev => ({ ...prev, [stmt]: err instanceof Error ? err.message : 'Save failed.' }))
    } finally {
      setSaving(prev => ({ ...prev, [stmt]: false }))
    }
  }

  const isLoading = loading[activeStmt]
  const stmtRows = rows[activeStmt]
  const stmtWaterfall = waterfalls[activeStmt] ?? null
  const hasTemplate = !!stmtRows

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Label column override */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-border bg-gray-50 text-[11px] text-muted-foreground">
        <span>Label column override:</span>
        <input
          type="number"
          min={1}
          placeholder="auto"
          value={labelColInput}
          onChange={e => setLabelColInput(e.target.value)}
          className="w-16 border border-border rounded px-1.5 py-0.5 text-[11px] text-foreground"
        />
        <button
          onClick={saveLabelColOverride}
          disabled={labelColSaving}
          className="px-2 py-0.5 rounded text-[11px] text-white disabled:opacity-50"
          style={{ backgroundColor: '#030213' }}
        >
          {labelColSaved ? '✓ Saved' : labelColSaving ? '…' : 'Save'}
        </button>
        <span className="text-slate-400">e.g. 3 = column C. Leave blank to auto-detect.</span>
      </div>

      {/* Statement sub-tabs + save button */}
      <div className="shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-border bg-gray-50">
        <div className="flex gap-1">
          {(['income_statement', 'balance_sheet', 'cash_flow_statement'] as StmtTab[]).map(stmt => (
            <button
              key={stmt}
              onClick={() => setActiveStmt(stmt)}
              className={`px-3 py-1 rounded text-[12px] transition-colors ${
                activeStmt === stmt
                  ? 'bg-white border border-border shadow-sm text-foreground'
                  : 'text-muted-foreground hover:bg-gray-100'
              }`}
              style={{ fontWeight: activeStmt === stmt ? 500 : 400 }}
            >
              {STMT_LABELS[stmt]}
            </button>
          ))}
        </div>

        {hasTemplate && (
          <div className="flex items-center gap-2">
            {errors[activeStmt] && (
              <span className="text-[11px] text-red-600">{errors[activeStmt]}</span>
            )}
            {saved[activeStmt] && (
              <span className="text-[11px] text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Saved
              </span>
            )}
            <button
              onClick={() => handleDelete(activeStmt)}
              disabled={!!deleting[activeStmt]}
              className="flex items-center gap-1.5 px-3 py-1 rounded text-[12px] text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50 transition-colors"
              style={{ fontWeight: 500 }}
              title="Delete template — triggers new template editor on next upload"
            >
              {deleting[activeStmt]
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Trash2 className="w-3.5 h-3.5" />}
              Delete
            </button>
            <button
              onClick={() => handleSave(activeStmt)}
              disabled={!!saving[activeStmt]}
              className="flex items-center gap-1.5 px-3 py-1 rounded text-[12px] text-white disabled:opacity-50"
              style={{ backgroundColor: '#030213', fontWeight: 500 }}
            >
              {saving[activeStmt]
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <CheckCircle2 className="w-3.5 h-3.5" />}
              Save {STMT_LABELS[activeStmt]}
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : !hasTemplate ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[12px] text-muted-foreground">
              No {STMT_FULL[activeStmt]} template yet — will be created on first upload.
            </p>
          </div>
        ) : (
          <TemplateTreeEditor
            rows={stmtRows!}
            waterfall={stmtWaterfall}
            statementType={activeStmt}
            onChange={(r, w) => handleChange(activeStmt, r, w)}
          />
        )}
      </div>
    </div>
  )
}
