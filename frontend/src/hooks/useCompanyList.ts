/**
 * useCompanyList — owns all state and logic for the admin Company list.
 *
 * Hides:
 *   - companies/loading state + fetch effect
 *   - search, adding, addText, addSaving state
 *   - addInputRef + delayed focus on startAdding
 *   - sortField / sortDir + handleSort toggle
 *   - client-side filter + sort derivation (filtered)
 *   - optimistic create (appends to local array) and delete
 *
 * Returns everything CompanyList needs to render the search bar,
 * sort controls, add-company form, and company rows.
 */
import { useEffect, useRef, useState } from 'react'
import { adminGetCompanies, adminCreateCompany, adminDeleteCompany, AdminCompany } from '../api/client'
import { useTableSort } from './useTableSort'
import { compareValues } from '../utils/sortUtils'
import { getErrorMessage } from '../utils/errorUtils'

export type CompanySortField = 'name' | 'context_word_count' | 'total_corrections'

export function useCompanyList() {
  const [companies, setCompanies] = useState<AdminCompany[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [addText, setAddText] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const { sortField, sortDir, handleSort } = useTableSort<CompanySortField>(
    'name', 'asc', ['context_word_count', 'total_corrections'],
  )
  const addInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    adminGetCompanies()
      .then(setCompanies)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  function startAdding() {
    setAddText('')
    setAdding(true)
    setTimeout(() => addInputRef.current?.focus(), 0)
  }

  function cancelAdding() {
    setAdding(false)
    setAddText('')
  }

  async function handleCreate() {
    if (!addText.trim() || addSaving) return
    setAddSaving(true)
    try {
      const created = await adminCreateCompany(addText.trim())
      setCompanies((prev) => [...prev, {
        id: created.id,
        name: created.name,
        context_word_count: 0,
        total_corrections: 0,
        processed_corrections: 0,
        pending_corrections: 0,
      }])
      setAdding(false)
      setAddText('')
    } catch (err) {
      alert(getErrorMessage(err, 'Failed to create company'))
    } finally {
      setAddSaving(false)
    }
  }

  async function handleDelete(e: React.MouseEvent, company: AdminCompany) {
    e.stopPropagation()
    if (!window.confirm(`Delete ${company.name} and all its context data? This cannot be undone.`)) return
    try {
      await adminDeleteCompany(company.id)
      setCompanies((prev) => prev.filter((c) => c.id !== company.id))
    } catch (err) {
      alert(getErrorMessage(err, 'Failed to delete company'))
    }
  }

  const filtered = companies
    .filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      let av: string | number, bv: string | number
      if (sortField === 'name') {
        av = a.name.toLowerCase()
        bv = b.name.toLowerCase()
      } else {
        av = a[sortField]
        bv = b[sortField]
      }
      return compareValues(av, bv, sortDir)
    })

  return {
    companies,
    loading,
    search,
    setSearch,
    adding,
    addText,
    setAddText,
    addSaving,
    addInputRef,
    sortField,
    sortDir,
    handleSort,
    filtered,
    startAdding,
    cancelAdding,
    handleCreate,
    handleDelete,
  }
}
