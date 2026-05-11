/**
 * useCompanyDetail — owns data loading and rename logic for the Company Detail admin view.
 *
 * Hides:
 *   - context / contextContent / periods / corrections / loading state
 *   - Parallel fetch useEffect (adminGetCompanyContext, adminGetCompanyData, adminGetCompanyCorrections)
 *   - renaming / renameText / renameSaving / renameInputRef rename state + ref
 *   - startRename — copies current name to input, sets renaming=true, auto-focuses
 *   - cancelRename — clears rename state
 *   - saveRename — calls adminRenameCompany, updates context.name on success
 */
import { useEffect, useRef, useState } from 'react'
import {
  adminGetCompanyContext,
  adminGetCompanyData,
  adminGetCompanyCorrections,
  adminRenameCompany,
} from '../api/client'
import type { AdminCompanyContext, CompanyPeriodData, AdminCorrection } from '../api/client'

interface UseCompanyDetailOptions {
  companyId: number
}

export function useCompanyDetail({ companyId }: UseCompanyDetailOptions) {
  const [context, setContext] = useState<AdminCompanyContext | null>(null)
  const [contextContent, setContextContent] = useState<string>('')
  const [periods, setPeriods] = useState<CompanyPeriodData[]>([])
  const [corrections, setCorrections] = useState<AdminCorrection[]>([])
  const [loading, setLoading] = useState(true)

  // Rename state
  const [renaming, setRenaming] = useState(false)
  const [renameText, setRenameText] = useState('')
  const [renameSaving, setRenameSaving] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      adminGetCompanyContext(companyId),
      adminGetCompanyData(companyId),
      adminGetCompanyCorrections(companyId),
    ])
      .then(([ctx, data, corr]) => {
        setContext(ctx)
        setContextContent(ctx.content ?? '')
        setPeriods(data.periods)
        setCorrections(corr.corrections)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [companyId])

  function startRename() {
    setRenameText(context?.name ?? '')
    setRenaming(true)
    setTimeout(() => renameInputRef.current?.select(), 0)
  }

  function cancelRename() {
    setRenaming(false)
    setRenameText('')
  }

  async function saveRename() {
    if (!renameText.trim() || renameSaving) return
    setRenameSaving(true)
    try {
      const res = await adminRenameCompany(companyId, renameText.trim())
      setContext((prev) => (prev ? { ...prev, name: res.new_name } : prev))
      setRenaming(false)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Rename failed')
    } finally {
      setRenameSaving(false)
    }
  }

  return {
    context,
    contextContent,
    setContextContent,
    periods,
    corrections,
    loading,
    renaming,
    renameText,
    setRenameText,
    renameSaving,
    renameInputRef,
    startRename,
    cancelRename,
    saveRename,
  }
}
