import { useEffect, useState } from 'react'
import { Loader2, Download } from 'lucide-react'
import { adminGetReviews, adminExportReviewUrl, AdminReview } from './AdminApiClient'

const STATUS_OPTIONS = ['', 'finalized', 'step2_complete', 'step1_complete', 'new']

export default function ReviewsList() {
  const [reviews, setReviews] = useState<AdminReview[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')

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
                <th className="text-left px-3 py-2 text-muted-foreground" style={{ fontWeight: 500 }}>Company</th>
                <th className="text-left px-3 py-2 text-muted-foreground" style={{ fontWeight: 500 }}>Period</th>
                <th className="text-left px-3 py-2 text-muted-foreground font-mono" style={{ fontWeight: 500 }}>Session</th>
                <th className="text-center px-3 py-2 text-muted-foreground" style={{ fontWeight: 500 }}>Status</th>
                <th className="text-right px-3 py-2 text-muted-foreground" style={{ fontWeight: 500 }}>Corrections</th>
                <th className="text-right px-3 py-2 text-muted-foreground" style={{ fontWeight: 500 }}>Created</th>
                <th className="text-right px-3 py-2 text-muted-foreground" style={{ fontWeight: 500 }}>Finalized</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {reviews.map((r, i) => (
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
                </tr>
              ))}
              {reviews.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No reviews found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
