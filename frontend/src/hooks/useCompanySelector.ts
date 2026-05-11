import { useEffect, useRef, useState } from 'react'
import { getCompanies, createCompany } from '../api/client'
import type { Company } from '../types'
import { getErrorMessage } from '../utils/errorUtils'

interface UseCompanySelectorOptions {
  /** Called when a company is selected (existing or newly created). */
  onSelect: (company: Company) => void
  /** Called when the search field is cleared — parent should reset company id/name in wizard state. */
  onClear: () => void
  /** Called when create company fails. */
  onError: (msg: string) => void
  /** Initial value for the search field, synced from wizard state. */
  initialName?: string
}

function normalizeCompanyName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function findFuzzyMatches(input: string, allCompanies: Company[]): Company[] {
  const normalizedInput = normalizeCompanyName(input)
  if (normalizedInput.length < 2) return []
  return allCompanies.filter((c) => {
    const normalizedName = normalizeCompanyName(c.name)
    return normalizedName.includes(normalizedInput) || normalizedInput.includes(normalizedName)
  })
}

export function useCompanySelector({
  onSelect,
  onClear,
  onError,
  initialName = '',
}: UseCompanySelectorOptions) {
  const [companies, setCompanies] = useState<Company[]>([])
  const [companiesLoading, setCompaniesLoading] = useState(false)
  const [comboOpen, setComboOpen] = useState(false)
  const [comboSearch, setComboSearch] = useState(initialName)
  const [creatingCompany, setCreatingCompany] = useState(false)
  const comboRef = useRef<HTMLDivElement>(null)

  // Load companies once on mount
  useEffect(() => {
    setCompaniesLoading(true)
    getCompanies()
      .then(setCompanies)
      .catch(() => {})
      .finally(() => setCompaniesLoading(false))
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setComboOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredCompanies = companies.filter((c) =>
    c.name.toLowerCase().includes(comboSearch.toLowerCase()),
  )

  const hasExactMatch = companies.some(
    (c) => c.name.toLowerCase() === comboSearch.trim().toLowerCase(),
  )

  const filteredIds = new Set(filteredCompanies.map((c) => c.id))
  const fuzzyMatches =
    comboSearch.trim() && !hasExactMatch
      ? findFuzzyMatches(comboSearch.trim(), companies).filter((c) => !filteredIds.has(c.id))
      : []

  function handleSearchChange(value: string) {
    setComboSearch(value)
    setComboOpen(true)
    if (!value) onClear()
  }

  function handleSelectCompany(company: Company) {
    setComboSearch(company.name)
    setComboOpen(false)
    onSelect(company)
  }

  async function handleCreateCompany() {
    const name = comboSearch.trim()
    if (!name) return
    setCreatingCompany(true)
    try {
      const newCompany = await createCompany(name)
      setCompanies((prev) =>
        [...prev, newCompany].sort((a, b) => a.name.localeCompare(b.name)),
      )
      setComboSearch(newCompany.name)
      setComboOpen(false)
      onSelect(newCompany)
    } catch (err) {
      onError(getErrorMessage(err, 'Failed to create company.'))
    } finally {
      setCreatingCompany(false)
    }
  }

  return {
    comboRef,
    companies,
    companiesLoading,
    comboOpen,
    setComboOpen,
    comboSearch,
    handleSearchChange,
    filteredCompanies,
    fuzzyMatches,
    hasExactMatch,
    creatingCompany,
    handleSelectCompany,
    handleCreateCompany,
  }
}
