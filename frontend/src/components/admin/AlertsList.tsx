import { useEffect, useState } from 'react'
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { adminGetAlerts } from './AdminApiClient'

export default function AlertsList() {
  const [alerts, setAlerts] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showResolved, setShowResolved] = useState(false)

  useEffect(() => {
    setLoading(true)
    adminGetAlerts(showResolved ? undefined : false)
      .then((data) => {
        setAlerts(data.alerts)
        setTotal(data.total_alerts)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [showResolved])

  const columns = alerts.length > 0 ? Object.keys(alerts[0]) : []

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-amber-500" />
          <h2 className="text-[15px]" style={{ fontWeight: 600 }}>Alerts</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-muted-foreground">{total} total</span>
          <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
            />
            Show resolved
          </label>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-2">
          <CheckCircle2 className="w-8 h-8 text-emerald-400" />
          <p className="text-[13px] text-muted-foreground">No active alerts.</p>
        </div>
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
              {alerts.map((row, i) => (
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
