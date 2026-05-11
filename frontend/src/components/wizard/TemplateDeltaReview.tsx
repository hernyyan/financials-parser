/**
 * TemplateDeltaReview
 *
 * Shown after Layer 1 extraction when a template already exists but new
 * unmatched line items were found. User maps new items to existing rows
 * or adds them as new rows, then saves.
 */
import type { Layer1TemplateRow, StatementType } from '../../types'
import TemplateTreeEditor from './TemplateTreeEditor'
import { Loader2, CheckCircle2, ArrowRight } from 'lucide-react'
import { useTemplateDeltaReview } from '../../hooks/useTemplateDeltaReview'
import { STATEMENT_LABELS } from '../../utils/statementMeta'

interface Props {
  unmatchedItems: Layer1TemplateRow[]
  statementType: string
  companyId: number
  onSaved: () => void
  onSkip: () => void
}

export default function TemplateDeltaReview({ unmatchedItems, statementType, companyId, onSaved, onSkip }: Props) {
  const {
    rows,
    waterfall,
    loading,
    error,
    saving,
    actions,
    selectingTargetFor,
    setSelectingTargetFor,
    setAction,
    handleTreeChange,
    handleSave,
  } = useTemplateDeltaReview({ unmatchedItems, statementType, companyId, onSaved })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-border bg-white flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px]" style={{ fontWeight: 600 }}>
            {unmatchedItems.length} New Line Item{unmatchedItems.length !== 1 ? 's' : ''} — {STATEMENT_LABELS[statementType as StatementType] ?? statementType}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            These items weren't in the stored template. Choose what to do with each, then save.
          </p>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          <div className="flex gap-2">
            <button
              onClick={onSkip}
              className="px-3 py-1.5 rounded text-[12px] border border-border text-muted-foreground hover:bg-gray-50"
            >
              Skip
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] text-white disabled:opacity-50"
              style={{ backgroundColor: '#030213', fontWeight: 500 }}
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Save Updates
            </button>
          </div>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Left: unmatched items */}
        <div className="w-80 shrink-0 border-r border-border flex flex-col overflow-hidden">
          <div className="shrink-0 px-3 py-2 border-b border-border bg-gray-50">
            <p className="text-[11px] text-muted-foreground" style={{ fontWeight: 500 }}>New Items</p>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            {unmatchedItems.map((item, i) => {
              const action = actions[i]
              return (
                <div key={i} className="px-3 py-2 border-b border-gray-100 text-[12px]">
                  <p className="truncate" style={{ fontWeight: 500 }}>{item.label}</p>
                  <div className="flex gap-1.5 mt-1.5 flex-wrap">
                    <button
                      onClick={() => setAction(i, { kind: 'add', type: 'individual' })}
                      className={`px-2 py-0.5 rounded border text-[10px] transition-colors ${action?.kind === 'add' && action.type === 'individual' ? 'bg-gray-800 text-white border-gray-800' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                      style={{ fontWeight: 500 }}
                    >
                      + Add IND
                    </button>
                    <button
                      onClick={() => setAction(i, { kind: 'add', type: 'sum' })}
                      className={`px-2 py-0.5 rounded border text-[10px] transition-colors ${action?.kind === 'add' && action.type === 'sum' ? 'bg-blue-600 text-white border-blue-600' : 'border-blue-200 text-blue-700 hover:bg-blue-50'}`}
                      style={{ fontWeight: 500 }}
                    >
                      + Add SUM
                    </button>
                    <button
                      onClick={() => setSelectingTargetFor(selectingTargetFor === i ? null : i)}
                      className={`px-2 py-0.5 rounded border text-[10px] transition-colors ${action?.kind === 'map' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'}`}
                      style={{ fontWeight: 500 }}
                    >
                      <ArrowRight className="w-2.5 h-2.5 inline mr-0.5" />
                      Map to existing
                    </button>
                  </div>
                  {action?.kind === 'map' && (
                    <p className="text-[10px] text-emerald-700 mt-1">Mapped (will not be added)</p>
                  )}
                  {selectingTargetFor === i && (
                    <p className="text-[10px] text-muted-foreground mt-1">Click a row in the template on the right →</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Right: stored template tree (editable) */}
        <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
          <div className="shrink-0 px-3 py-2 border-b border-border bg-gray-50">
            <p className="text-[11px] text-muted-foreground" style={{ fontWeight: 500 }}>Stored Template</p>
          </div>
          <div className="flex-1 overflow-hidden min-h-0">
            {rows.length > 0 ? (
              <TemplateTreeEditor
                rows={rows}
                waterfall={waterfall}
                statementType={statementType}
                onChange={handleTreeChange}
              />
            ) : (
              <p className="p-4 text-[12px] text-muted-foreground">No template loaded.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
