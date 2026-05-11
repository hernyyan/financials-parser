/**
 * Layer1TemplatesTab
 *
 * Admin CompanyDetail sub-panel for viewing and editing Layer 1 templates.
 * Shows IS / BS / CFS sub-tabs, each with a full TemplateTreeEditor.
 */
import TemplateTreeEditor from '../wizard/TemplateTreeEditor'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { useLayer1Templates, type StmtTab } from '../../hooks/useLayer1Templates'
import { STATEMENT_LABELS, STATEMENT_ABBREVS, ALL_STATEMENT_TYPES } from '../../utils/statementMeta'

interface Props {
  companyId: number
}

const STMT_LABELS = STATEMENT_ABBREVS
const STMT_FULL = STATEMENT_LABELS

export default function Layer1TemplatesTab({ companyId }: Props) {
  const {
    activeStmt,
    setActiveStmt,
    saving,
    errors,
    saved,
    isLoading,
    stmtRows,
    stmtWaterfall,
    hasTemplate,
    handleChange,
    handleSave,
  } = useLayer1Templates({ companyId })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Statement sub-tabs + save button */}
      <div className="shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-border bg-gray-50">
        <div className="flex gap-1">
          {ALL_STATEMENT_TYPES.map((stmt) => (
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
