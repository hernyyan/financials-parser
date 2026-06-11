/**
 * SourceLayoutsTab
 *
 * Admin CompanyDetail sub-panel for viewing saved source layouts.
 * Read-only — layouts are only updated via user uploads.
 *
 * Two views per statement:
 *   User View — formatted DataTable (bold/italic/indent applied)
 *   Raw JSON  — full JSON dump of stored rows
 */
import { useEffect, useState } from 'react'
import { Loader2, X, Table2, FileCode } from 'lucide-react'
import { API_BASE } from '../../api/client'
import DataTable from '../shared/DataTable'

interface Props {
  companyId: number
}

type StmtTab = 'income_statement' | 'balance_sheet' | 'cash_flow_statement'

const STMT_FULL: Record<StmtTab, string> = {
  income_statement: 'Income Statement',
  balance_sheet: 'Balance Sheet',
  cash_flow_statement: 'Cash Flow Statement',
}

interface StoredRow {
  row_index: number
  label: string
  bold?: boolean | null
  italic?: boolean | null
  indent?: number | null
}

interface RawData {
  source_layout: { data: StoredRow[]; saved_at: string } | null
}

export default function SourceLayoutsTab({ companyId }: Props) {
  const [loading, setLoading] = useState<Partial<Record<StmtTab, boolean>>>({
    income_statement: true, balance_sheet: true, cash_flow_statement: true,
  })
  const [layouts, setLayouts] = useState<Partial<Record<StmtTab, StoredRow[] | null>>>({})
  const [savedAt, setSavedAt] = useState<Partial<Record<StmtTab, string>>>({})

  // Modal state
  const [openStmt, setOpenStmt] = useState<StmtTab | null>(null)
  const [viewMode, setViewMode] = useState<'user' | 'raw'>('user')

  useEffect(() => {
    const stmts: StmtTab[] = ['income_statement', 'balance_sheet', 'cash_flow_statement']
    stmts.forEach(stmt => {
      fetch(`${API_BASE}/companies/${companyId}/layer1-templates/${stmt}/raw`)
        .then(r => r.ok ? r.json() : null)
        .then((data: RawData | null) => {
          setLayouts(prev => ({ ...prev, [stmt]: data?.source_layout?.data ?? null }))
          setSavedAt(prev => ({ ...prev, [stmt]: data?.source_layout?.saved_at ?? '' }))
        })
        .catch(() => setLayouts(prev => ({ ...prev, [stmt]: null })))
        .finally(() => setLoading(prev => ({ ...prev, [stmt]: false })))
    })
  }, [companyId])

  function openModal(stmt: StmtTab) {
    setOpenStmt(stmt)
    setViewMode('user')
  }

  const stmts: StmtTab[] = ['income_statement', 'balance_sheet', 'cash_flow_statement']

  const openLayout = openStmt ? (layouts[openStmt] ?? null) : null

  // Build DataTable rows from stored layout rows
  function buildTableRows(rows: StoredRow[]): React.ComponentProps<typeof DataTable>['rows'] {
    return rows.map(r => ({
      label: r.label,
      value: `Row ${r.row_index}`,
      isBold: r.bold === true,
      isItalic: r.italic === true,
      indentLevel: r.indent ?? 0,
    }))
  }

  return (
    <div className="flex flex-col h-full overflow-hidden p-3 gap-2">
      <p className="text-[11px] text-muted-foreground">
        Saved source layouts — updated by user uploads. Click a statement to inspect.
      </p>

      {/* Statement buttons */}
      <div className="flex gap-2 flex-wrap">
        {stmts.map(stmt => {
          const isLoading = loading[stmt]
          const hasLayout = !!layouts[stmt]
          const rowCount = layouts[stmt]?.length ?? 0
          return (
            <button
              key={stmt}
              onClick={() => !isLoading && openModal(stmt)}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-[13px] transition-colors hover:bg-gray-50 disabled:opacity-50"
              style={{ fontWeight: 500 }}
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              ) : hasLayout ? (
                <Table2 className="w-4 h-4 text-cyan-500" />
              ) : (
                <div className="w-4 h-4 rounded-full border-2 border-gray-300" />
              )}
              {STMT_FULL[stmt]}
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${hasLayout ? 'bg-cyan-50 text-cyan-700' : 'bg-gray-100 text-gray-400'}`}>
                {isLoading ? '…' : hasLayout ? `${rowCount} rows` : 'none'}
              </span>
            </button>
          )
        })}
      </div>

      {/* Modal */}
      {openStmt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpenStmt(null)} />
          <div
            className="relative flex flex-col bg-white rounded-xl shadow-2xl overflow-hidden"
            style={{ width: '70vw', height: '80vh', maxWidth: 1000 }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex-shrink-0 flex items-center gap-3 px-5 py-3 border-b border-border" style={{ backgroundColor: '#0f172a' }}>
              <div className="text-sm font-semibold text-white">{STMT_FULL[openStmt]} — Source Layout</div>
              {savedAt[openStmt] && (
                <span className="text-[11px] text-slate-400">
                  saved {new Date(savedAt[openStmt]!).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              <div className="flex items-center gap-1 ml-2">
                {(['user', 'raw'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={`px-2.5 py-1 rounded text-[11px] transition-colors ${viewMode === mode ? 'bg-white text-slate-800' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
                  >
                    {mode === 'user' ? 'User View' : 'Raw JSON'}
                  </button>
                ))}
              </div>
              <div className="flex-1" />
              <button onClick={() => setOpenStmt(null)} className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-hidden min-h-0">
              {!openLayout ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                  <FileCode className="w-10 h-10 opacity-30" />
                  <p className="text-[13px]">No layout saved for {STMT_FULL[openStmt]}.</p>
                  <p className="text-[11px] opacity-70">It will be saved when the user runs extraction for the first time.</p>
                </div>
              ) : viewMode === 'raw' ? (
                <div className="h-full overflow-auto p-4 bg-slate-950 font-mono text-[11px] leading-relaxed">
                  <pre className="text-cyan-300 whitespace-pre-wrap break-all">
                    {JSON.stringify(openLayout, null, 2)}
                  </pre>
                </div>
              ) : (
                <div className="h-full overflow-y-auto">
                  <DataTable
                    rows={buildTableRows(openLayout)}
                    noScroll
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
