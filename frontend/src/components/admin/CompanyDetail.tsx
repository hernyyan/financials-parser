import { useState } from 'react'
import { ChevronLeft, Check, X, Edit3, Loader2 } from 'lucide-react'
import { useCompanyDetail } from '../../hooks/useCompanyDetail'
import CompanyContextEditor from './CompanyContextEditor'
import TemplateFieldList from './TemplateFieldList'
import RuleWriter from './RuleWriter'
import CompanyDataTable from './CompanyDataTable'
import Layer1TemplatesTab from './Layer1TemplatesTab'
import CompanyCorrectionsTable from './CompanyCorrectionsTable'

interface Props {
  companyId: number
  onBack: () => void
}

type Tab = 'data' | 'corrections' | 'datasets' | 'l1_templates'


export default function CompanyDetail({ companyId, onBack }: Props) {
  const {
    context,
    contextContent,
    setContextContent,
    periods,
    corrections,
    loading,
    renaming,
    renameText,
    setRenameText,
    renameSaving,
    renameInputRef,
    startRename,
    cancelRename,
    saveRename,
  } = useCompanyDetail({ companyId })

  const [activeTab, setActiveTab] = useState<Tab>('data')
  const [selectedField, setSelectedField] = useState<{ name: string; statementType: string } | null>(null)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'data', label: 'L1 / L2 Data' },
    { key: 'corrections', label: `Corrections (${corrections.length})` },
    { key: 'datasets', label: 'Datasets' },
    { key: 'l1_templates', label: 'L1 Templates' },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Back bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-white shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Companies
        </button>
        <span className="text-muted-foreground text-[12px]">/</span>
        {renaming ? (
          <div className="flex items-center gap-1">
            <input
              ref={renameInputRef}
              className="border border-border rounded px-2 py-0.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/20"
              value={renameText}
              onChange={(e) => setRenameText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveRename()
                if (e.key === 'Escape') cancelRename()
              }}
              disabled={renameSaving}
              style={{ minWidth: 180 }}
            />
            <button
              onClick={saveRename}
              disabled={renameSaving || !renameText.trim()}
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-50"
            >
              {renameSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 text-emerald-600" />}
            </button>
            <button onClick={cancelRename} className="p-1 rounded hover:bg-gray-100">
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-[13px]" style={{ fontWeight: 500 }}>{context?.name ?? `Company ${companyId}`}</span>
            <button onClick={startRename} className="p-1 rounded hover:bg-gray-100 text-muted-foreground hover:text-foreground transition-colors">
              <Edit3 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Three-panel section */}
      <div className="flex border-b border-border shrink-0" style={{ height: 340 }}>
        {/* Left: Context Editor — ~35% */}
        <div className="flex-[4] border-r border-border flex flex-col overflow-hidden min-w-[280px]">
          <CompanyContextEditor
            companyId={companyId}
            content={contextContent}
            onSaved={(newContent) => setContextContent(newContent)}
          />
        </div>

        {/* Center: Template Fields — ~25% */}
        <div className="flex-[3] border-r border-border flex flex-col overflow-hidden min-w-[220px]">
          <TemplateFieldList
            contextContent={contextContent}
            selectedField={selectedField}
            onSelectField={setSelectedField}
          />
        </div>

        {/* Right: Rule Writer — ~30% */}
        <div className="flex-[3.5] flex flex-col overflow-hidden min-w-[280px]">
          <RuleWriter
            companyId={companyId}
            selectedField={selectedField}
            onRuleApplied={(updatedMarkdown) => setContextContent(updatedMarkdown)}
          />
        </div>
      </div>

      {/* Tabbed bottom section */}
      <div className="flex flex-col flex-1 overflow-hidden min-h-0">
        {/* Tab bar */}
        <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border bg-gray-50 shrink-0">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-3 py-1 rounded text-[12px] transition-colors ${
                activeTab === t.key
                  ? 'text-foreground bg-white border border-border shadow-sm'
                  : 'text-muted-foreground hover:bg-gray-100'
              }`}
              style={{ fontWeight: activeTab === t.key ? 500 : 400 }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-hidden min-h-0">
          {activeTab === 'data' && (
            <CompanyDataTable periods={periods} />
          )}

          {activeTab === 'corrections' && (
            <div className="h-full overflow-auto">
              <CompanyCorrectionsTable corrections={corrections} />
            </div>
          )}

          {activeTab === 'datasets' && (
            <div className="h-full overflow-auto p-4">
              <p className="text-[12px] text-muted-foreground">
                {periods.length === 0
                  ? 'No datasets uploaded for this company.'
                  : `${periods.length} dataset${periods.length !== 1 ? 's' : ''} found.`}
              </p>
              {periods.length > 0 && (
                <div className="mt-3 space-y-2">
                  {periods.map((p) => (
                    <div key={p.session_id} className="flex items-center gap-4 px-3 py-2 border border-border rounded-lg bg-white text-[12px]">
                      <span className="font-mono text-muted-foreground text-[11px]">{p.session_id.slice(0, 8)}</span>
                      <span style={{ fontWeight: 500 }}>{p.reporting_period || 'No period'}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                        p.status === 'finalized' ? 'bg-emerald-50 text-emerald-700' :
                        p.status === 'step2_complete' ? 'bg-blue-50 text-blue-700' :
                        'bg-gray-100 text-gray-600'
                      }`} style={{ fontWeight: 500 }}>{p.status}</span>
                      <span className="text-muted-foreground ml-auto">{p.created_at ? new Date(p.created_at).toLocaleDateString() : '—'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'l1_templates' && (
            <Layer1TemplatesTab companyId={companyId} />
          )}
        </div>
      </div>
    </div>
  )
}
