/**
 * usePdfExtraction — encapsulates all PDF-specific extraction state and logic.
 *
 * Owns: pdfActiveTab, pdfExtracting
 * Depends on (passed in): sessionId, reportingPeriod, companyId, companyName,
 *   pdfPageAssignments, mergeLayer1Result, setStatus, setDuplicateCheck, setPendingExtraction
 */
import { useState } from 'react'
import { runLayer1Pdf } from '../api/client'
import type { Layer1Result, StatusMessage, StatementType } from '../types'
import { ALL_STATEMENT_TYPES } from '../utils/statementMeta'
import { toLayer1Result } from '../utils/layer1Utils'
import { getErrorMessage } from '../utils/errorUtils'

export interface PdfExtractionDeps {
  sessionId: string | null
  reportingPeriod: string
  companyName: string
  companyId: number | null
  pdfPageAssignments: Record<number, StatementType>
  mergeLayer1Result: (type: string, result: Layer1Result) => void
  setStatus: (s: StatusMessage) => void
  checkBeforeRun: (pendingType: 'pdf' | 'global') => Promise<boolean>
}

export function usePdfExtraction({
  sessionId,
  reportingPeriod,
  companyName,
  companyId,
  pdfPageAssignments,
  mergeLayer1Result,
  setStatus,
  checkBeforeRun,
}: PdfExtractionDeps) {
  const [pdfActiveTab, setPdfActiveTab] = useState<StatementType>('income_statement')
  const [pdfExtracting, setPdfExtracting] = useState<Record<string, boolean>>({})

  async function handlePdfRunAllInner() {
    const stmtTypes = ALL_STATEMENT_TYPES
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
          mergeLayer1Result(type, toLayer1Result(result, `PDF pages ${pages.join(', ')}`))
        } catch (err) {
          setStatus({
            type: 'error',
            message: `Extraction failed for ${type}: ${getErrorMessage(err, 'Unknown error')}`,
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
    if (await checkBeforeRun('pdf')) return
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
