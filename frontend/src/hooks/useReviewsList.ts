/**
 * useReviewsList — owns all state and logic for the admin Reviews list.
 *
 * Hides:
 *   - reviews/total/loading state + fetch effect (re-triggers on filter change)
 *   - statusFilter / companyFilter / correctionsFilter state
 *   - sortField / sortDir state + handleSort toggle logic
 *   - periodToSortKey (from periodUtils) for chronological sort of reporting_period
 *   - client-side filter + multi-field sort derivation (displayed)
 *   - two-click confirm-delete pattern + async handleDelete
 *
 * Returns everything ReviewsList needs to render the toolbar and table.
 */
import { useEffect, useState } from 'react'
import { adminGetReviews, adminDeleteReview, AdminReview } from '../api/client'
import { useTableSort } from './useTableSort'
import { periodToSortKey } from '../utils/periodUtils'
import { compareValues } from '../utils/sortUtils'

export type SortField = 'company_name' | 'reporting_period' | 'status' | 'corrections_count' | 'created_at'
export type CorrectionsFilter = 'all' | 'has' | 'none'

export function useReviewsList() {
  const [reviews, setReviews] = useState<AdminReview[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [correctionsFilter, setCorrectionsFilter] = useState<CorrectionsFilter>('all')
  const { sortField, sortDir, handleSort } = useTableSort<SortField>('created_at', 'desc', ['created_at'])
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

  const displayed = reviews
    .filter((r) => {
      if (correctionsFilter === 'has') return r.corrections_count > 0
      if (correctionsFilter === 'none') return r.corrections_count === 0
      return true
    })
    .sort((a, b) => {
      let av: string | number, bv: string | number
      if (sortField === 'reporting_period') {
        av = periodToSortKey(a.reporting_period)
        bv = periodToSortKey(b.reporting_period)
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
      return compareValues(av, bv, sortDir)
    })

  return {
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
  }
}
