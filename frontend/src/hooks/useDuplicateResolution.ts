/**
 * useDuplicateResolution — owns the duplicate-review modal lifecycle.
 *
 * Manages: duplicateCheck state (shown when a prior review exists),
 * pendingExtraction state (remembers which run triggered the check),
 * handleContinuePrevious (load prior session into wizard), and
 * handleOverwrite (dismiss modal and re-run extraction).
 *
 * Both extraction hooks (useExcelExtraction, usePdfExtraction) write to
 * setDuplicateCheck / setPendingExtraction to trigger the modal.
 */
import { useState } from 'react'
import { checkExistingReview, continuePreviousReview } from '../api/client'
import type { Layer1Result, Layer2Result, Correction, StatusMessage, DuplicateCheck, PendingExtraction } from '../types'
import { getErrorMessage } from '../utils/errorUtils'

interface UseDuplicateResolutionDeps {
  companyId: number | null
  reportingPeriod: string
  setSessionId: (id: string | null) => void
  setLayer1Results: (r: Record<string, Layer1Result>) => void
  setLayer2Results: (r: Record<string, Layer2Result>) => void
  addCorrection: (c: Correction) => void
  approveStep1: () => void
  setStatus: (s: StatusMessage) => void
}

export function useDuplicateResolution({
  companyId,
  reportingPeriod,
  setSessionId,
  setLayer1Results,
  setLayer2Results,
  addCorrection,
  approveStep1,
  setStatus,
}: UseDuplicateResolutionDeps) {
  const [duplicateCheck, setDuplicateCheck] = useState<DuplicateCheck>(null)
  const [pendingExtraction, setPendingExtraction] = useState<PendingExtraction>(null)

  /**
   * Check for an existing finalized review before running extraction.
   * Returns true if a duplicate was found (extraction should be deferred);
   * false if extraction can proceed immediately.
   */
  async function checkBeforeRun(pendingType: 'pdf' | 'global'): Promise<boolean> {
    if (!companyId) return false
    try {
      const existing = await checkExistingReview(companyId, reportingPeriod)
      if (existing.exists) {
        setDuplicateCheck({
          exists: true,
          sessionId: existing.session_id!,
          finalizedAt: existing.finalized_at ?? null,
        })
        setPendingExtraction({ type: pendingType })
        return true
      }
    } catch {
      // proceed on check failure
    }
    return false
  }

  async function handleContinuePrevious() {
    if (!companyId) return
    setDuplicateCheck(null)
    try {
      const data = await continuePreviousReview(companyId, reportingPeriod)

      if (!data.layer1_data || typeof data.layer1_data !== 'object') {
        console.warn('[handleContinuePrevious] layer1_data missing or malformed', data.layer1_data)
      }
      if (data.layer2_data && typeof data.layer2_data !== 'object') {
        console.warn('[handleContinuePrevious] layer2_data malformed', data.layer2_data)
      }

      setSessionId(data.session_id)
      setLayer1Results(data.layer1_data || {})
      if (data.layer2_data) {
        setLayer2Results(data.layer2_data)
      }
      if (data.corrections && Array.isArray(data.corrections)) {
        for (const c of data.corrections) {
          addCorrection({
            fieldName: c.field_name,
            originalValue: c.layer2_value ?? 0,
            correctedValue: c.corrected_value,
            reasoning: c.analyst_reasoning ?? undefined,
            tag: c.tag,
            timestamp: new Date().toISOString(),
          })
        }
      }
      approveStep1()
    } catch (err) {
      setStatus({
        type: 'error',
        message: getErrorMessage(err, 'Failed to load previous review.'),
      })
    }
  }

  return {
    duplicateCheck,
    setDuplicateCheck,
    pendingExtraction,
    setPendingExtraction,
    checkBeforeRun,
    handleContinuePrevious,
  }
}
