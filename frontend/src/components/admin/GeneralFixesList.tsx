import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { adminGetGeneralFixes } from './AdminApiClient'

export default function GeneralFixesList() {
  const [entries, setEntries] = useState<Record<string, string>[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [companyFilter, setCompanyFilter] = useState('')

  useEffect(() => {
    setLoading(true)
    adminGetGeneralFixes({ company: companyFilter || undefined, limit: 200 })
      .then((data) => {
        setEntries(data.entries)
        setTotal(data.total_entries)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [companyFilter])

  const columns = entries.length > 0 ? Object.keys(entries[0]) : []

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-[15px]" style={{ fontWeight: 600 }}>General Fixes</h2>
        <span className="text-[12px] text-muted-foreground">{total} total</span>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <input
          className="bg-white border border-border rounded-lg px-3 py-1.5 text-[13px] outline-none w-48"
          placeholder="Filter by company..."
          value={companyFilter}
          onChange={(e) => setCompanyFilter(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-[13px] text-muted-foreground py-8 text-center">No general fixes found.</p>
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
                  {columns.map((col) => (
                    <td key={col} className="px-3 py-1.5 text-muted-foreground max-w-[300px] truncate">
                      {row[col] ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
