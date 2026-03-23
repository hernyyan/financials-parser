import { useCallback, useEffect, useState } from 'react'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { adminGetAlerts, adminUpdateAlertStatus } from './AdminApiClient'

type AlertStatus = 'open' | 'resolved' | 'fixed' | 'all'

const STATUS_TABS: { key: AlertStatus; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'fixed', label: 'Fixed' },
  { key: 'all', label: 'All' },
]

function TypeBadge({ type }: { type: string }) {
  if (type === 'duplicate_company_name') {
    return (
      <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-50 text-purple-700" style={{ fontWeight: 600 }}>
        duplicate company
      </span>
    )
  }
  if (type === 'markdown_overlength') {
    return (
      <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-700" style={{ fontWeight: 600 }}>
        context overlength
      </span>
    )
  }
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-600" style={{ fontWeight: 600 }}>
      {type}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'resolved') {
    return <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-50 text-emerald-700" style={{ fontWeight: 500 }}>resolved</span>
  }
  if (status === 'fixed') {
    return <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-50 text-blue-700" style={{ fontWeight: 500 }}>fixed</span>
  }
  return <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-700" style={{ fontWeight: 500 }}>open</span>
}

export default function AlertsList() {
  const [alerts, setAlerts] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<AlertStatus>('open')
  const [updating, setUpdating] = useState<number | null>(null)

  const loadAlerts = useCallback(() => {
    setLoading(true)
    adminGetAlerts(statusFilter)
      .then((data) => {
        setAlerts(data.alerts)
        setTotal(data.total_alerts)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [statusFilter])

  useEffect(() => {
    loadAlerts()
  }, [loadAlerts])

  async function handleStatusUpdate(fileIndex: number, newStatus: string) {
    setUpdating(fileIndex)
    try {
      await adminUpdateAlertStatus(fileIndex, newStatus)
      loadAlerts()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update alert')
    } finally {
      setUpdating(null)
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-[15px]" style={{ fontWeight: 600 }}>Alerts</h2>
        <span className="text-[12px] text-muted-foreground">{total} shown</span>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 mb-5">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setStatusFilter(t.key)}
            className={`px-3 py-1 rounded text-[12px] transition-colors ${
              statusFilter === t.key
                ? 'text-foreground bg-white border border-border shadow-sm'
                : 'text-muted-foreground hover:bg-gray-100'
            }`}
            style={{ fontWeight: statusFilter === t.key ? 500 : 400 }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-2">
          <CheckCircle2 className="w-8 h-8 text-emerald-400" />
          <p className="text-[13px] text-muted-foreground">No alerts.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert, i) => {
            const fileIndex = typeof alert._file_index === 'number' ? alert._file_index : i
            const type = String(alert.type ?? '')
            const status = String(alert.status ?? 'open')
            const message = String(alert.message ?? '')
            const timestamp = alert.timestamp ? new Date(String(alert.timestamp)).toLocaleString() : null
            const isDuplicate = type === 'duplicate_company_name'
            const isOpen = status === 'open'

            return (
              <div key={fileIndex} className="bg-white border border-border rounded-lg p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <TypeBadge type={type} />
                      {!isOpen && <StatusBadge status={status} />}
                      {timestamp && (
                        <span className="text-[11px] text-muted-foreground">{timestamp}</span>
                      )}
                    </div>
                    <p className="text-[13px]">{message}</p>
                    {isDuplicate && (
                      <div className="flex items-center gap-3 mt-2 text-[12px] text-muted-foreground">
                        <span className="px-2 py-0.5 bg-gray-50 rounded border border-gray-200">{String(alert.company_name_a ?? '')}</span>
                        <span>↔</span>
                        <span className="px-2 py-0.5 bg-gray-50 rounded border border-gray-200">{String(alert.company_name_b ?? '')}</span>
                        <span className="text-[11px] font-mono text-muted-foreground">→ {String(alert.normalized_name ?? '')}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {updating === fileIndex ? (
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    ) : isOpen ? (
                      <>
                        <button
                          onClick={() => handleStatusUpdate(fileIndex, 'resolved')}
                          className="px-2.5 py-1 rounded text-[11px] border border-border hover:bg-gray-50 transition-colors text-muted-foreground"
                          style={{ fontWeight: 500 }}
                        >
                          Resolve
                        </button>
                        <button
                          onClick={() => handleStatusUpdate(fileIndex, 'fixed')}
                          className="px-2.5 py-1 rounded text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors"
                          style={{ fontWeight: 500 }}
                        >
                          Fixed
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleStatusUpdate(fileIndex, 'open')}
                        className="px-2.5 py-1 rounded text-[11px] border border-border hover:bg-gray-50 transition-colors text-muted-foreground"
                        style={{ fontWeight: 500 }}
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
