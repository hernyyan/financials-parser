import { useEffect, useState } from 'react'
import { Loader2, X, Download } from 'lucide-react'
import { adminGetGeneralFixes } from './AdminApiClient'
import { exportToCsv } from '../../utils/csvExport'

type SortField = 'timestamp' | 'period' | 'statement_type' | 'field_name' | 'company'

const SORTABLE: SortField[] = ['timestamp', 'company', 'period', 'statement_type', 'field_name']

export default function GeneralFixesList() {
  const [entries, setEntries] = useState<Record<string, string>[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [companyFilter, setCompanyFilter] = useState('')
  const [stmtFilter, setStmtFilter] = useState('')
  const [fieldFilter, setFieldFilter] = useState('')
  const [sortField, setSortField] = useState<SortField>('timestamp')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [expandedCell, setExpandedCell] = useState<{ column: string; value: string } | null>(null)

  useEffect(() => {
    setLoading(true)
    adminGetGeneralFixes({ company: companyFilter || undefined, limit: 500 })
      .then((data) => {
        setEntries(data.entries)
        setTotal(data.total_entries)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [companyFilter])

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir(field === 'timestamp' ? 'desc' : 'asc')
    }
  }

  function SortIndicator({ field }: { field: SortField }) {
    if (sortField !== field) return <span className="opacity-20 ml-0.5">▲</span>
    return <span className="text-blue-600 ml-0.5">{sortDir === 'asc' ? '▲' : '▼'}</span>
  }

  const filtered = entries
    .filter((r) => {
      if (stmtFilter && r['statement_type'] !== stmtFilter) return false
      if (fieldFilter && !(r['field_name'] ?? '').toLowerCase().includes(fieldFilter.toLowerCase())) return false
      return true
    })
    .sort((a, b) => {
      const av = (a[sortField] ?? '').toLowerCase()
      const bv = (b[sortField] ?? '').toLowerCase()
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })

  const columns = entries.length > 0 ? Object.keys(entries[0]) : []

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-[15px]" style={{ fontWeight: 600 }}>General Fixes</h2>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-muted-foreground">{filtered.length} of {total}</span>
          {filtered.length > 0 && (
            <button
              onClick={() => exportToCsv(filtered as Record<string, unknown>[], 'general_fixes.csv')}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] border border-border bg-white hover:bg-gray-50 transition-colors text-muted-foreground hover:text-foreground"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <input
          className="bg-white border border-border rounded-lg px-3 py-1.5 text-[13px] outline-none w-40"
          placeholder="Filter by company..."
          value={companyFilter}
          onChange={(e) => setCompanyFilter(e.target.value)}
        />
        <select
          className="bg-white border border-border rounded-lg px-3 py-1.5 text-[13px] outline-none"
          value={stmtFilter}
          onChange={(e) => setStmtFilter(e.target.value)}
        >
          <option value="">All statement types</option>
          <option value="income_statement">income_statement</option>
          <option value="balance_sheet">balance_sheet</option>
        </select>
        <input
          className="bg-white border border-border rounded-lg px-3 py-1.5 text-[13px] outline-none w-40"
          placeholder="Filter by field name..."
          value={fieldFilter}
          onChange={(e) => setFieldFilter(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-[13px] text-muted-foreground py-8 text-center">No general fixes found.</p>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden overflow-x-auto">
          <table className="text-[12px] border-collapse w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-border">
                {columns.map((col) => {
                  const isSortable = SORTABLE.includes(col as SortField)
                  return (
                    <th
                      key={col}
                      className={`text-left px-3 py-2 text-muted-foreground whitespace-nowrap ${isSortable ? 'cursor-pointer hover:text-foreground select-none' : ''}`}
                      style={{ fontWeight: 500 }}
                      onClick={isSortable ? () => handleSort(col as SortField) : undefined}
                    >
                      {col}
                      {isSortable && <SortIndicator field={col as SortField} />}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={i} className={i % 2 === 0 ? '' : 'bg-gray-50/50'}>
                  {columns.map((col) => {
                    const val = row[col]
                    const display = val === null || val === undefined ? '—' : String(val)
                    return (
                      <td
                        key={col}
                        className="px-3 py-1.5 text-muted-foreground max-w-[300px] truncate cursor-pointer hover:bg-gray-100/60"
                        onClick={() => setExpandedCell({ column: col, value: display })}
                      >
                        {display}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {expandedCell && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setExpandedCell(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h3 className="text-[13px]" style={{ fontWeight: 600 }}>{expandedCell.column}</h3>
              <button onClick={() => setExpandedCell(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 overflow-auto flex-1">
              <pre className="text-[12px] text-foreground whitespace-pre-wrap break-words font-sans">{expandedCell.value}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
