import { Loader2, Download, Trash2 } from 'lucide-react'
import { adminExportReviewUrl } from './AdminApiClient'
import { useReviewsList, SortField, CorrectionsFilter } from '../../hooks/useReviewsList'

const STATUS_OPTIONS = ['finalized', 'step2_complete', 'step1_complete', 'new']

function SortIndicator({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: 'asc' | 'desc' }) {
  if (sortField !== field) return <span className="opacity-20 ml-0.5">▲</span>
  return <span className="text-blue-600 ml-0.5">{sortDir === 'asc' ? '▲' : '▼'}</span>
}

export default function ReviewsList() {
  const {
    displayed,
    total,
    loading,
    statusFilter,
    setStatusFilter,
    companyFilter,
    setCompanyFilter,
    correctionsFilter,
    setCorrectionsFilter,
    sortField,
    sortDir,
    handleSort,
    confirmDelete,
    setConfirmDelete,
    deleting,
    handleDelete,
  } = useReviewsList()

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
          {STATUS_OPTIONS.map((s) => (
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
                  Company <SortIndicator field="company_name" sortField={sortField} sortDir={sortDir} />
                </th>
                <th className={thClass} style={{ fontWeight: 500 }} onClick={() => handleSort('reporting_period')}>
                  Period <SortIndicator field="reporting_period" sortField={sortField} sortDir={sortDir} />
                </th>
                <th className="text-left px-3 py-2 text-muted-foreground font-mono whitespace-nowrap" style={{ fontWeight: 500 }}>Session</th>
                <th className={`${thClass} text-center`} style={{ fontWeight: 500 }} onClick={() => handleSort('status')}>
                  Status <SortIndicator field="status" sortField={sortField} sortDir={sortDir} />
                </th>
                <th className={`${thClass} text-right`} style={{ fontWeight: 500 }} onClick={() => handleSort('corrections_count')}>
                  Corrections <SortIndicator field="corrections_count" sortField={sortField} sortDir={sortDir} />
                </th>
                <th className={`${thClass} text-right`} style={{ fontWeight: 500 }} onClick={() => handleSort('created_at')}>
                  Created <SortIndicator field="created_at" sortField={sortField} sortDir={sortDir} />
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
