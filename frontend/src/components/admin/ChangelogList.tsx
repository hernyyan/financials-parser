import { useEffect, useState } from 'react'
import { Loader2, X, Download } from 'lucide-react'
import { adminGetChangelog } from './AdminApiClient'
import { exportToCsv } from '../../utils/csvExport'

export default function ChangelogList() {
  const [entries, setEntries] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [expandedCell, setExpandedCell] = useState<{ column: string; value: string } | null>(null)

  useEffect(() => {
    setLoading(true)
    adminGetChangelog({ limit: 200 })
      .then((data) => {
        setEntries(data.entries)
        setTotal(data.total_entries)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const columns = entries.length > 0 ? Object.keys(entries[0]) : []

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-[15px]" style={{ fontWeight: 600 }}>Changelog</h2>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-muted-foreground">{total} total</span>
          {entries.length > 0 && (
            <button
              onClick={() => exportToCsv(entries as Record<string, unknown>[], 'changelog.csv')}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] border border-border bg-white hover:bg-gray-50 transition-colors text-muted-foreground hover:text-foreground"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-[13px] text-muted-foreground py-8 text-center">No changelog entries found.</p>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden overflow-x-auto">
          <table className="text-[12px] border-collapse w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-border">
                {columns.map((col) => (
                  <th key={col} className="text-left px-3 py-2 text-muted-foreground whitespace-nowrap" style={{ fontWeight: 500 }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((row, i) => (
                <tr key={i} className={i % 2 === 0 ? '' : 'bg-gray-50/50'}>
                  {columns.map((col) => {
                    const val = row[col]
                    const display = val === null || val === undefined ? '—' : typeof val === 'object' ? JSON.stringify(val) : String(val)
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
