/**
 * useExcelExtraction — encapsulates all Excel-specific extraction state and logic.
 *
 * Owns: assignments, extractionStatus, extractionError, templateReview
 * Depends on (passed in): sessionId, reportingPeriod, companyId, companyName,
 *   mergeLayer1Result, setStatus, setDuplicateCheck, setPendingExtraction
 */
import { useState } from 'react'
import { runLayer1, saveLayer1Template, saveStatementTabConfig } from '../api/client'
import type { Layer1Result, Layer1Template, Layer1TemplateRow, TemplateCheckResult, StatusMessage, StatementType } from '../types'
import { ALL_STATEMENT_TYPES, createStmtRecord } from '../utils/statementMeta'
import { toLayer1Result } from '../utils/layer1Utils'

export type ExtractionStatus = 'idle' | 'running' | 'done' | 'error'

export type Assignments = Record<StatementType, string>

export type TemplateReviewState = {
  mode: 'new' | 'delta'
  structured: Layer1Template
  statementType: string
  unmatchedItems?: Layer1TemplateRow[]
} | null

export interface ExcelExtractionDeps {
  sessionId: string | null
  reportingPeriod: string
  companyName: string
  companyId: number | null
  mergeLayer1Result: (type: string, result: Layer1Result) => void
  setStatus: (s: StatusMessage) => void
  checkBeforeRun: (pendingType: 'pdf' | 'global') => Promise<boolean>
}

const EMPTY_ASSIGNMENTS: Assignments = createStmtRecord('')

export function useExcelExtraction({
  sessionId,
  reportingPeriod,
  companyName,
  companyId,
  mergeLayer1Result,
  setStatus,
  checkBeforeRun,
}: ExcelExtractionDeps) {
  const [assignments, setAssignments] = useState<Assignments>(EMPTY_ASSIGNMENTS)
  const [extractionStatus, setExtractionStatus] = useState<ExtractionStatus>('idle')
  const [extractionError, setExtractionError] = useState<string | null>(null)
  const [templateReview, setTemplateReview] = useState<TemplateReviewState>(null)

  async function runExtractionInner() {
    setExtractionStatus('running')
    setExtractionError(null)

    const stmtTypes = ALL_STATEMENT_TYPES
    const results: Partial<Record<string, Awaited<ReturnType<typeof runLayer1>>>> = {}

    // Detect shared tabs (same sheet assigned to multiple statement types)
    const assignedTabs = stmtTypes.map((s) => assignments[s]).filter(Boolean)
    const tabCounts: Record<string, number> = {}
    for (const t of assignedTabs) tabCounts[t] = (tabCounts[t] ?? 0) + 1

    const tasks = stmtTypes
      .filter((stmtType) => assignments[stmtType])
      .map(async (stmtType) => {
        const tab = assignments[stmtType]
        const sharedTab = tabCounts[tab] > 1
        const result = await runLayer1(
          sessionId!,
          tab,
          stmtType,
          reportingPeriod,
          undefined,
          companyId,
          sharedTab,
        )
        results[stmtType] = result
        mergeLayer1Result(stmtType, toLayer1Result(result, tab))
      })

    try {
      const settled = await Promise.allSettled(tasks)
      const failed = settled.filter((s) => s.status === 'rejected')

      if (failed.length > 0 && settled.every((s) => s.status === 'rejected')) {
        const msg = (failed[0] as PromiseRejectedResult).reason?.message ?? 'Extraction failed.'
        setExtractionStatus('error')
        setExtractionError(msg)
        setStatus({ type: 'error', message: msg })
        return
      }
      if (failed.length > 0) {
        const msg =
          (failed[0] as PromiseRejectedResult).reason?.message ?? 'One or more extractions failed.'
        setStatus({ type: 'error', message: msg })
      }
      setExtractionStatus('done')

      // Persist tab assignments so next upload can auto-restore them
      if (companyId) {
        for (const stmtType of stmtTypes) {
          const tab = assignments[stmtType]
          if (tab) {
            saveStatementTabConfig(companyId, stmtType, { tab }).catch(() => {})
          }
        }
      }

      // Template review for IS (only when companyId is known)
      if (companyId) {
        const isResult = results['income_statement']
        if (isResult?.structured) {
          const check = isResult.templateCheck as TemplateCheckResult | undefined

          // Auto-save BS/CFS templates on first upload
          for (const stmtType of ['balance_sheet', 'cash_flow_statement'] as const) {
            const r = results[stmtType]
            if (r?.structured && check && !check.has_template) {
              const tmpl: Layer1Template = {
                meta: { statement_type: stmtType, created_at: new Date().toISOString() },
                rows: r.structured.rows,
              }
              saveLayer1Template(companyId, stmtType, tmpl).catch((err) => {
                console.warn(`Auto-save template failed for ${stmtType}:`, err)
              })
            }
          }

          if (!check || !check.has_template) {
            setTemplateReview({
              mode: 'new',
              structured: isResult.structured,
              statementType: 'income_statement',
            })
            return
          }

          if (check.has_template && check.unmatched_items?.length > 0) {
            setTemplateReview({
              mode: 'delta',
              structured: isResult.structured,
              statementType: 'income_statement',
              unmatchedItems: check.unmatched_items,
            })
            return
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Extraction failed.'
      setExtractionStatus('error')
      setExtractionError(msg)
      setStatus({ type: 'error', message: msg })
    }
  }

  async function handleRunExtraction() {
    if (!sessionId || !reportingPeriod.trim() || !companyName.trim()) return
    if (await checkBeforeRun('global')) return
    runExtractionInner()
  }

  function reset() {
    setAssignments(EMPTY_ASSIGNMENTS)
    setExtractionStatus('idle')
    setExtractionError(null)
    setTemplateReview(null)
  }

  return {
    assignments,
    setAssignments,
    extractionStatus,
    setExtractionStatus,
    extractionError,
    setExtractionError,
    templateReview,
    setTemplateReview,
    runExtractionInner,
    handleRunExtraction,
    reset,
  }
}
