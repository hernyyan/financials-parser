import { useEffect, useRef, useState } from 'react'
import { runLayer2 } from '../api/client'
import type { Layer1Result, Layer2Result, StatementType } from '../types'
import { ALL_STATEMENT_TYPES, STATEMENT_LABELS } from '../utils/statementMeta'

type RunStatus = 'idle' | 'loading' | 'done' | 'error'

const STMT_TYPES = ALL_STATEMENT_TYPES
const STMT_LABELS = STATEMENT_LABELS

const INIT_STATUS: Record<StatementType, RunStatus> = {
  income_statement: 'idle',
  balance_sheet: 'idle',
  cash_flow_statement: 'idle',
}
const INIT_ERROR: Record<StatementType, string | null> = {
  income_statement: null,
  balance_sheet: null,
  cash_flow_statement: null,
}

interface UseClassificationDeps {
  sessionId: string | null
  companyId: number | null
  useCompanyContext: boolean
  layer1Results: Record<string, Layer1Result>
  layer2Results: Record<string, Layer2Result>
  /** Called once when all parallel runs complete with a merged results map. */
  setLayer2Results: (results: Record<string, Layer2Result>) => void
}

export function useClassification({
  sessionId,
  companyId,
  useCompanyContext,
  layer1Results,
  layer2Results,
  setLayer2Results,
}: UseClassificationDeps) {
  const [stmtStatus, setStmtStatus] = useState<Record<StatementType, RunStatus>>(INIT_STATUS)
  const [stmtError, setStmtError] = useState<Record<StatementType, string | null>>(INIT_ERROR)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const classifyingRef = useRef(false)

  const isClassifying = Object.values(stmtStatus).some((s) => s === 'loading')

  // Tick elapsed seconds while classification is running
  useEffect(() => {
    if (!isClassifying) {
      setElapsedSeconds(0)
      return
    }
    setElapsedSeconds(0)
    const interval = setInterval(() => setElapsedSeconds((s) => s + 1), 1000)
    return () => clearInterval(interval)
  }, [isClassifying])

  function _setRunStatus(type: StatementType, s: RunStatus) {
    setStmtStatus((prev) => ({ ...prev, [type]: s }))
  }
  function _setRunError(type: StatementType, err: string | null) {
    setStmtError((prev) => ({ ...prev, [type]: err }))
  }

  async function run() {
    if (classifyingRef.current) {
      console.warn('[useClassification] run: already running, skipping') // eslint-disable-line no-console
      return
    }
    classifyingRef.current = true
    setStmtError(INIT_ERROR)

    const newResults: Record<string, Layer2Result> = { ...layer2Results }
    const tasks: Promise<void>[] = []

    for (const key of STMT_TYPES) {
      if (layer1Results[key] && stmtStatus[key] !== 'done') {
        _setRunStatus(key, 'loading')
        tasks.push(
          runLayer2({
            session_id: sessionId,
            statement_type: key,
            layer1_data: layer1Results[key].lineItems,
            company_id: companyId,
            use_company_context: useCompanyContext,
          })
            .then((result) => {
              newResults[key] = result
              _setRunStatus(key, 'done')
            })
            .catch((err) => {
              _setRunStatus(key, 'error')
              _setRunError(
                key,
                err instanceof Error ? err.message : `${STMT_LABELS[key]} classification failed.`,
              )
            }),
        )
      } else if (!layer1Results[key]) {
        _setRunStatus(key, 'done')
      }
    }

    console.log('[useClassification] waiting for', tasks.length, 'task(s) to settle') // eslint-disable-line no-console
    await Promise.allSettled(tasks)
    console.log('[useClassification] all tasks settled — newResults keys:', Object.keys(newResults)) // eslint-disable-line no-console

    if (Object.keys(newResults).length > 0) {
      setLayer2Results(newResults)
    } else {
      console.warn('[useClassification] no results to persist — all tasks failed or skipped') // eslint-disable-line no-console
    }
    classifyingRef.current = false
  }

  function retry() {
    classifyingRef.current = false
    _setRunStatus('cash_flow_statement', 'idle')
    run()
  }

  /** Mark all statements done without re-running — used when results are already loaded. */
  function markAllDone() {
    setStmtStatus({ income_statement: 'done', balance_sheet: 'done', cash_flow_statement: 'done' })
  }

  return {
    stmtStatus,
    stmtError,
    isClassifying,
    elapsedSeconds,
    run,
    retry,
    markAllDone,
    STMT_TYPES,
    STMT_LABELS,
  }
}
