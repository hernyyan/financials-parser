/**
 * useContextStatus — owns company context status fetching state.
 *
 * Centralises the fetch-on-company-select and fetch-on-file-upload paths that
 * were previously duplicated between Step1Upload and useFileUpload.
 *
 * Exposes:
 *   contextStatus    — current fetch result (null = not fetched / cleared)
 *   contextLoading   — true while a fetch is in-flight
 *   fetchContext(id) — trigger a fetch for a given company
 *   clearContext()   — reset to null (called on upload clear / company deselect)
 */
import { useState } from 'react'
import { getCompanyContextStatus } from '../api/client'
import type { CompanyContextStatus } from '../types'

export function useContextStatus() {
  const [contextStatus, setContextStatus] = useState<CompanyContextStatus | null>(null)
  const [contextLoading, setContextLoading] = useState(false)

  function fetchContext(companyId: number) {
    setContextLoading(true)
    getCompanyContextStatus(companyId)
      .then(setContextStatus)
      .catch(() => setContextStatus(null))
      .finally(() => setContextLoading(false))
  }

  function clearContext() {
    setContextStatus(null)
  }

  return { contextStatus, contextLoading, fetchContext, clearContext }
}
