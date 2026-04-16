import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Check, X, Edit3, Loader2 } from 'lucide-react'
import { adminGetCompanyContext, adminGetCompanyData, adminGetCompanyCorrections, adminRenameCompany, AdminCompanyContext, CompanyPeriodData, AdminCorrection } from './AdminApiClient'
import { getStatementTabConfigs } from '../../api/client'
import type { StatementTabConfig } from '../../api/client'
import CompanyContextEditor from './CompanyContextEditor'
import TemplateFieldList from './TemplateFieldList'
import RuleWriter from './RuleWriter'
import CompanyDataTable from './CompanyDataTable'

interface Props {
  companyId: number
  onBack: () => void
}

type Tab = 'data' | 'corrections' | 'datasets' | 'tab_config'

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') {
    if (v === 0) return '0'
    const abs = Math.abs(v)
    const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return v < 0 ? `(${formatted})` : formatted
  }
  return String(v)
}

export default function CompanyDetail({ companyId, onBack }: Props) {
  const [context, setContext] = useState<AdminCompanyContext | null>(null)
  const [contextContent, setContextContent] = useState<string>('')
  const [periods, setPeriods] = useState<CompanyPeriodData[]>([])
  const [corrections, setCorrections] = useState<AdminCorrection[]>([])
  const [tabConfigs, setTabConfigs] = useState<Record<string, StatementTabConfig>>({})
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('data')
  const [selectedField, setSelectedField] = useState<{ name: string; statementType: string } | null>(null)

  // Rename state
  const [renaming, setRenaming] = useState(false)
  const [renameText, setRenameText] = useState('')
  const [renameSaving, setRenameSaving] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      adminGetCompanyContext(companyId),
      adminGetCompanyData(companyId),
      adminGetCompanyCorrections(companyId),
      getStatementTabConfigs(companyId).catch(() => ({})),
    ]).then(([ctx, data, corr, cfgs]) => {
      setContext(ctx)
      setContextContent(ctx.content ?? '')
      setPeriods(data.periods)
      setCorrections(corr.corrections)
      setTabConfigs(cfgs as Record<string, StatementTabConfig>)
    }).catch(console.error).finally(() => setLoading(false))
  }, [companyId])

  function startRename() {
    setRenameText(context?.name ?? '')
    setRenaming(true)
    setTimeout(() => renameInputRef.current?.select(), 0)
  }

  function cancelRename() {
    setRenaming(false)
    setRenameText('')
  }

  async function saveRename() {
    if (!renameText.trim() || renameSaving) return
    setRenameSaving(true)
    try {
      const res = await adminRenameCompany(companyId, renameText.trim())
      setContext((prev) => prev ? { ...prev, name: res.new_name } : prev)
      setRenaming(false)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Rename failed')
    } finally {
      setRenameSaving(false)
    }
  }

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
    { key: 'tab_config', label: 'Tab Config' },
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
              {corrections.length === 0 ? (
                <p className="text-[12px] text-muted-foreground p-4">No corrections for this company.</p>
              ) : (
                <table className="text-[12px] border-collapse w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-border sticky top-0">
                      <th className="text-left px-3 py-2 text-muted-foreground" style={{ fontWeight: 500 }}>Period</th>
                      <th className="text-left px-3 py-2 text-muted-foreground" style={{ fontWeight: 500 }}>Statement</th>
                      <th className="text-left px-3 py-2 text-muted-foreground" style={{ fontWeight: 500 }}>Field</th>
                      <th className="text-right px-3 py-2 text-muted-foreground font-mono" style={{ fontWeight: 500 }}>L2 Value</th>
                      <th className="text-right px-3 py-2 text-muted-foreground font-mono" style={{ fontWeight: 500 }}>Corrected</th>
                      <th className="text-left px-3 py-2 text-muted-foreground" style={{ fontWeight: 500 }}>Reasoning</th>
                      <th className="text-center px-3 py-2 text-muted-foreground" style={{ fontWeight: 500 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {corrections.map((c, i) => (
                      <tr key={c.id} className={i % 2 === 0 ? '' : 'bg-gray-50/50'}>
                        <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{c.period || '—'}</td>
                        <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                          {c.statement_type === 'income_statement' ? 'IS' : 'BS'}
                        </td>
                        <td className="px-3 py-1.5">{c.field_name}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{formatVal(c.layer2_value)}</td>
                        <td className={`px-3 py-1.5 text-right font-mono ${c.corrected_value < 0 ? 'text-red-600' : ''}`}>
                          {formatVal(c.corrected_value)}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground max-w-[300px] truncate">{c.analyst_reasoning || '—'}</td>
                        <td className="px-3 py-1.5 text-center">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${c.processed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`} style={{ fontWeight: 500 }}>
                            {c.processed ? 'processed' : 'pending'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
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
          {activeTab === 'tab_config' && (
            <div className="h-full overflow-auto p-4">
              {Object.keys(tabConfigs).length === 0 ? (
                <p className="text-[12px] text-muted-foreground">No tab configs saved for this company.</p>
              ) : (
                <div className="space-y-6">
                  {(
                    [
                      { key: 'income_statement', label: 'Income Statement' },
                      { key: 'balance_sheet', label: 'Balance Sheet' },
                      { key: 'cash_flow_statement', label: 'Cash Flow Statement' },
                    ] as const
                  ).map(({ key, label }) => {
                    const cfg = tabConfigs[key]
                    if (!cfg || cfg.tabs.length < 2) return null
                    return (
                      <div key={key} className="space-y-3">
                        <p className="text-[11px] text-muted-foreground uppercase" style={{ fontWeight: 600, letterSpacing: '0.05em' }}>
                          {label}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {cfg.tabs.map((tab) => (
                            <span
                              key={tab}
                              className="px-2 py-0.5 rounded border border-border text-[12px] bg-white"
                            >
                              {tab}
                            </span>
                          ))}
                        </div>
                        {Object.keys(cfg.fieldAssignments).length > 0 && (
                          <table className="text-[12px] border-collapse w-full max-w-lg">
                            <thead>
                              <tr className="bg-gray-50 border-b border-border">
                                <th className="text-left px-3 py-1.5 text-muted-foreground" style={{ fontWeight: 500 }}>Field</th>
                                <th className="text-left px-3 py-1.5 text-muted-foreground" style={{ fontWeight: 500 }}>Tab</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.entries(cfg.fieldAssignments).map(([field, tab]) => (
                                <tr key={field} className="border-b border-gray-100">
                                  <td className="px-3 py-1.5">{field}</td>
                                  <td className="px-3 py-1.5 text-muted-foreground">{tab}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
