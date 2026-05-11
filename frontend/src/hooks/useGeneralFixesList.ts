/**
 * useGeneralFixesList — owns data loading, filtering, and sorting for the General Fixes admin view.
 *
 * Hides:
 *   - entries / total / loading / companyFilter / stmtFilter / fieldFilter state
 *   - sortField / sortDir / expandedCell state
 *   - fetch useEffect (refetches when companyFilter changes)
 *   - handleSort — toggles direction on same field, resets to sensible default on new field
 *   - filtered derivation — client-side filter by stmtFilter/fieldFilter + sort
 *   - columns derivation — Object.keys of first entry
 */
import { useEffect, useState } from 'react'
import { adminGetGeneralFixes } from '../components/admin/AdminApiClient'

export type SortField = 'timestamp' | 'period' | 'statement_type' | 'field_name' | 'company'

export function useGeneralFixesList() {
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
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir(field === 'timestamp' ? 'desc' : 'asc')
    }
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

  return {
    total,
    loading,
    companyFilter,
    setCompanyFilter,
    stmtFilter,
    setStmtFilter,
    fieldFilter,
    setFieldFilter,
    sortField,
    sortDir,
    expandedCell,
    setExpandedCell,
    handleSort,
    filtered,
    columns,
  }
}
