/**
 * usePdfExtraction — encapsulates all PDF-specific extraction state and logic.
 *
 * Owns: pdfActiveTab, pdfExtracting
 * Depends on (passed in): sessionId, reportingPeriod, companyId, companyName,
 *   pdfPageAssignments, mergeLayer1Result, setStatus, setDuplicateCheck, setPendingExtraction
 */
import { useState } from 'react'
import { runLayer1Pdf, checkExistingReview } from '../api/client'
import type { Layer1Result, StatusMessage, StatementType, DuplicateCheck, PendingExtraction } from '../types'

export interface PdfExtractionDeps {
  sessionId: string | null
  reportingPeriod: string
  companyName: string
  companyId: number | null
  pdfPageAssignments: Record<number, StatementType>
  mergeLayer1Result: (type: string, result: Layer1Result) => void
  setStatus: (s: StatusMessage) => void
  setDuplicateCheck: (v: DuplicateCheck) => void
  setPendingExtraction: (v: PendingExtraction) => void
}

export function usePdfExtraction({
  sessionId,
  reportingPeriod,
  companyName,
  companyId,
  pdfPageAssignments,
  mergeLayer1Result,
  setStatus,
  setDuplicateCheck,
  setPendingExtraction,
}: PdfExtractionDeps) {
  const [pdfActiveTab, setPdfActiveTab] = useState<StatementType>('income_statement')
  const [pdfExtracting, setPdfExtracting] = useState<Record<string, boolean>>({})

  async function handlePdfRunAllInner() {
    const stmtTypes: StatementType[] = ['income_statement', 'balance_sheet', 'cash_flow_statement']
    const toRun = stmtTypes.filter((type) =>
      Object.values(pdfPageAssignments).includes(type),
    )

    if (toRun.length === 0) {
      setStatus({
        type: 'error',
        message: 'Select pages for at least one statement before running extraction.',
      })
      return
    }

    const extracting: Record<string, boolean> = {}
    for (const type of toRun) extracting[type] = true
    setPdfExtracting(extracting)
    setStatus(null)

    await Promise.allSettled(
      toRun.map(async (type) => {
        const pages = Object.entries(pdfPageAssignments)
          .filter(([, t]) => t === type)
          .map(([p]) => parseInt(p))
          .sort((a, b) => a - b)
        try {
          const result = await runLayer1Pdf(sessionId!, pages, type, reportingPeriod)
          mergeLayer1Result(type, {
            lineItems: result.lineItems,
            sourceScaling: result.sourceScaling,
            columnIdentified: result.columnIdentified,
            sourceSheet: `PDF pages ${pages.join(', ')}`,
          } as Layer1Result)
        } catch (err) {
          setStatus({
            type: 'error',
            message: `Extraction failed for ${type}: ${err instanceof Error ? err.message : 'Unknown error'}`,
          })
        } finally {
          setPdfExtracting((prev) => ({ ...prev, [type]: false }))
        }
      }),
    )
  }

  async function handlePdfRunAll() {
    if (!sessionId || !reportingPeriod.trim() || !companyName.trim()) {
      setStatus({
        type: 'error',
        message: 'Please enter company name and reporting period before running extraction.',
      })
      return
    }

    if (companyId) {
      try {
        const existing = await checkExistingReview(companyId, reportingPeriod)
        if (existing.exists) {
          setDuplicateCheck({
            exists: true,
            sessionId: existing.session_id!,
            finalizedAt: existing.finalized_at ?? null,
          })
          setPendingExtraction({ type: 'pdf' })
          return
        }
      } catch {
        // proceed on check failure
      }
    }

    handlePdfRunAllInner()
  }

  function reset() {
    setPdfActiveTab('income_statement')
    setPdfExtracting({})
  }

  return {
    pdfActiveTab,
    setPdfActiveTab,
    pdfExtracting,
    handlePdfRunAllInner,
    handlePdfRunAll,
    reset,
  }
}
