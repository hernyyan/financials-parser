/**
 * TemplateReview
 *
 * Shown after Layer 1 extraction when no template exists yet for this company.
 * User reviews the IS structure and saves it as the template.
 * BS/CFS are saved silently (no review required).
 */
import { useState } from 'react'
import type { Layer1Template, Layer1TemplateRow, WaterfallStep } from '../../types'
import { saveLayer1Template } from '../../api/client'
import TemplateTreeEditor from './TemplateTreeEditor'
import { Loader2, CheckCircle2 } from 'lucide-react'

interface Props {
  structured: Layer1Template
  statementType: string
  companyId: number
  onSaved: () => void
}

export default function TemplateReview({ structured, statementType, companyId, onSaved }: Props) {
  const [rows, setRows] = useState<Layer1TemplateRow[]>(structured.rows)
  const [waterfall, setWaterfall] = useState<WaterfallStep[] | null>(
    statementType === 'income_statement' ? (structured.waterfall ?? []) : null
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleChange(newRows: Layer1TemplateRow[], newWaterfall: WaterfallStep[] | null) {
    setRows(newRows)
    setWaterfall(newWaterfall)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const template: Layer1Template = {
        meta: { statement_type: statementType, created_at: new Date().toISOString() },
        rows,
        ...(waterfall !== null ? { waterfall } : {}),
      }
      await saveLayer1Template(companyId, statementType, template)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template.')
    } finally {
      setSaving(false)
    }
  }

  const stmtLabel: Record<string, string> = {
    income_statement: 'Income Statement',
    balance_sheet: 'Balance Sheet',
    cash_flow_statement: 'Cash Flow Statement',
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-border bg-white flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px]" style={{ fontWeight: 600 }}>
            Review {stmtLabel[statementType] ?? statementType} Template
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            This is the first upload for this company. Review the row types and waterfall before saving.
            Badges are clickable: <span className="font-mono">SUM → IND</span> demotes,&nbsp;
            <span className="font-mono">IND → SUM</span> promotes with child selection.
          </p>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] text-white disabled:opacity-50"
            style={{ backgroundColor: '#030213', fontWeight: 500 }}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            Save Template
          </button>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
        </div>
      </div>

      {/* Tree editor */}
      <div className="flex-1 overflow-hidden min-h-0">
        <TemplateTreeEditor
          rows={rows}
          waterfall={waterfall}
          statementType={statementType}
          onChange={handleChange}
        />
      </div>
    </div>
  )
}
