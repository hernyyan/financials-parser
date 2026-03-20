import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { adminGetChangelog } from './AdminApiClient'

export default function ChangelogList() {
  const [entries, setEntries] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

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
        <span className="text-[12px] text-muted-foreground">{total} total</span>
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
                      <td key={col} className="px-3 py-1.5 text-muted-foreground max-w-[300px] truncate">
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
    </div>
  )
}
