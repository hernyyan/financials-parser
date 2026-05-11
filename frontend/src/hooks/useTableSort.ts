/**
 * useTableSort — manages sort field + direction state for tabular admin views.
 *
 * Encapsulates the toggle logic that appeared identically in useCompanyList,
 * useReviewsList, and useGeneralFixesList:
 *   - same field clicked → flip direction
 *   - new field clicked  → switch field, reset direction
 *                          (default: 'asc', unless field is in descFields)
 *
 * descFields: fields whose "natural" default is descending (e.g. timestamps).
 */
import { useState } from 'react'

export function useTableSort<F extends string>(
  defaultField: F,
  defaultDir: 'asc' | 'desc' = 'asc',
  descFields: F[] = [],
): {
  sortField: F
  sortDir: 'asc' | 'desc'
  handleSort: (field: F) => void
} {
  const [sortField, setSortField] = useState<F>(defaultField)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultDir)

  function handleSort(field: F) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir(descFields.includes(field) ? 'desc' : 'asc')
    }
  }

  return { sortField, sortDir, handleSort }
}
