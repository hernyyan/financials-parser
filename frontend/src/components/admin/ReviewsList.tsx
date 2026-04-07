import { useEffect, useState } from 'react'
import { Loader2, Download, Trash2 } from 'lucide-react'
import { adminGetReviews, adminExportReviewUrl, adminDeleteReview, AdminReview } from './AdminApiClient'

const STATUS_OPTIONS = ['', 'finalized', 'step2_complete', 'step1_complete', 'new']
type SortField = 'company_name' | 'reporting_period' | 'status' | 'corrections_count' | 'created_at'
type CorrectionsFilter = 'all' | 'has' | 'none'

const MONTH_ORDER: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
}

function parsePeriod(period: string | null): number {
  if (!period) return -Infinity
  const parts = period.trim().split(/\s+/)
  if (parts.length === 2) {
    const month = MONTH_ORDER[parts[0].toLowerCase()]
    const year = parseInt(parts[1])
    if (!isNaN(month) && !isNaN(year)) return year * 12 + month
  }
  return -Infinity
}

export default function ReviewsList() {
  const [reviews, setReviews] = useState<AdminReview[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [correctionsFilter, setCorrectionsFilter] = useState<CorrectionsFilter>('all')
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    adminGetReviews({
      status: statusFilter || undefined,
      company: companyFilter || undefined,
      limit: 200,
    }).then((data) => {
      setReviews(data.reviews)
      setTotal(data.total)
    }).catch(console.error).finally(() => setLoading(false))
  }, [statusFilter, companyFilter])

  async function handleDelete(sessionId: string) {
    if (confirmDelete !== sessionId) {
      setConfirmDelete(sessionId)
      return
    }
    setDeleting(sessionId)
    try {
      await adminDeleteReview(sessionId)
      setReviews((prev) => prev.filter((r) => r.session_id !== sessionId))
      setTotal((prev) => prev - 1)
    } catch (err) {
      console.error(err)
    } finally {
      setDeleting(null)
      setConfirmDelete(null)
    }
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir(field === 'created_at' ? 'desc' : 'asc')
    }
  }

  function SortIndicator({ field }: { field: SortField }) {
    if (sortField !== field) return <span className="opacity-20 ml-0.5">▲</span>
    return <span className="text-blue-600 ml-0.5">{sortDir === 'asc' ? '▲' : '▼'}</span>
  }

  const displayed = reviews
    .filter((r) => {
      if (correctionsFilter === 'has') return r.corrections_count > 0
      if (correctionsFilter === 'none') return r.corrections_count === 0
      return true
    })
    .sort((a, b) => {
      let av: string | number, bv: string | number
      if (sortField === 'reporting_period') {
        av = parsePeriod(a.reporting_period)
        bv = parsePeriod(b.reporting_period)
      } else if (sortField === 'corrections_count') {
        av = a.corrections_count
        bv = b.corrections_count
      } else if (sortField === 'created_at') {
        av = a.created_at ?? ''
        bv = b.created_at ?? ''
      } else {
        av = (a[sortField] ?? '').toString().toLowerCase()
        bv = (b[sortField] ?? '').toString().toLowerCase()
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })

  const thClass = 'text-left px-3 py-2 text-muted-foreground cursor-pointer select-none hover:text-foreground whitespace-nowrap'

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-[15px]" style={{ fontWeight: 600 }}>Reviews</h2>
        <span className="text-[12px] text-muted-foreground">{total} total</span>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <input
          className="bg-white border border-border rounded-lg px-3 py-1.5 text-[13px] outline-none w-48"
          placeholder="Filter by company..."
          value={companyFilter}
          onChange={(e) => setCompanyFilter(e.target.value)}
        />
        <select
          className="bg-white border border-border rounded-lg px-3 py-1.5 text-[13px] outline-none"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.slice(1).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          className="bg-white border border-border rounded-lg px-3 py-1.5 text-[13px] outline-none"
          value={correctionsFilter}
          onChange={(e) => setCorrectionsFilter(e.target.value as CorrectionsFilter)}
        >
          <option value="all">All corrections</option>
          <option value="has">Has corrections</option>
          <option value="none">No corrections</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="text-[12px] border-collapse w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-border">
                <th className={thClass} style={{ fontWeight: 500 }} onClick={() => handleSort('company_name')}>
                  Company <SortIndicator field="company_name" />
                </th>
                <th className={thClass} style={{ fontWeight: 500 }} onClick={() => handleSort('reporting_period')}>
                  Period <SortIndicator field="reporting_period" />
                </th>
                <th className="text-left px-3 py-2 text-muted-foreground font-mono whitespace-nowrap" style={{ fontWeight: 500 }}>Session</th>
                <th className={`${thClass} text-center`} style={{ fontWeight: 500 }} onClick={() => handleSort('status')}>
                  Status <SortIndicator field="status" />
                </th>
                <th className={`${thClass} text-right`} style={{ fontWeight: 500 }} onClick={() => handleSort('corrections_count')}>
                  Corrections <SortIndicator field="corrections_count" />
                </th>
                <th className={`${thClass} text-right`} style={{ fontWeight: 500 }} onClick={() => handleSort('created_at')}>
                  Created <SortIndicator field="created_at" />
                </th>
                <th className="text-right px-3 py-2 text-muted-foreground whitespace-nowrap" style={{ fontWeight: 500 }}>Finalized</th>
                <th className="px-3 py-2" />
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {displayed.map((r, i) => (
                <tr key={r.id} className={i % 2 === 0 ? '' : 'bg-gray-50/50'}>
                  <td className="px-3 py-1.5" style={{ fontWeight: 500 }}>{r.company_name}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{r.reporting_period || '—'}</td>
                  <td className="px-3 py-1.5 font-mono text-muted-foreground text-[11px]">{r.session_id.slice(0, 8)}</td>
                  <td className="px-3 py-1.5 text-center">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                      r.status === 'finalized' ? 'bg-emerald-50 text-emerald-700' :
                      r.status === 'step2_complete' ? 'bg-blue-50 text-blue-700' :
                      'bg-gray-100 text-gray-600'
                    }`} style={{ fontWeight: 500 }}>{r.status}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground">{r.corrections_count}</td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground whitespace-nowrap">
                    {r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground whitespace-nowrap">
                    {r.finalized_at ? new Date(r.finalized_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {r.status === 'finalized' && (
                      <a
                        href={adminExportReviewUrl(r.session_id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700"
                      >
                        <Download className="w-3 h-3" />
                        Export
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {deleting === r.session_id ? (
                      <Loader2 className="w-3 h-3 animate-spin text-muted-foreground inline" />
                    ) : confirmDelete === r.session_id ? (
                      <button
                        onClick={() => handleDelete(r.session_id)}
                        onBlur={() => setConfirmDelete(null)}
                        className="text-[11px] text-red-600 hover:text-red-700"
                        style={{ fontWeight: 500 }}
                        autoFocus
                      >
                        Confirm?
                      </button>
                    ) : (
                      <button
                        onClick={() => handleDelete(r.session_id)}
                        className="text-muted-foreground hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {displayed.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">No reviews found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
