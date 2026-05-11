/**
 * useTemplateDeltaReview — owns all state and logic for the TemplateDeltaReview workflow.
 *
 * Hides:
 *   - storedTemplate / rows / waterfall / loading / error / saving state
 *   - useEffect: fetch stored template on mount
 *   - nextId() — walks the row tree to find the next available ID
 *   - handleTreeChange — syncs rows + waterfall when the embedded editor fires onChange
 *   - setAction — records the chosen action (add IND/SUM or map) for an unmatched item index
 *   - handleSave — applies all pending actions, assembles the updated Layer1Template, and persists
 *
 * The `actions` and `selectingTargetFor` states are returned so the left-panel
 * UI can reflect selection state without knowing about the save mechanics.
 */
import { useEffect, useState } from 'react'
import type { Layer1Template, Layer1TemplateRow, WaterfallStep } from '../types'
import { getLayer1Template, saveLayer1Template } from '../api/client'
import { getErrorMessage } from '../utils/errorUtils'

export type NewItemAction =
  | { kind: 'add'; type: Layer1TemplateRow['type'] }
  | { kind: 'map'; targetId: number }

interface UseTemplateDeltaReviewOptions {
  unmatchedItems: Layer1TemplateRow[]
  statementType: string
  companyId: number
  onSaved: () => void
}

export function useTemplateDeltaReview({
  unmatchedItems,
  statementType,
  companyId,
  onSaved,
}: UseTemplateDeltaReviewOptions) {
  const [rows, setRows] = useState<Layer1TemplateRow[]>([])
  const [waterfall, setWaterfall] = useState<WaterfallStep[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [actions, setActionsState] = useState<Record<number, NewItemAction>>({})
  const [selectingTargetFor, setSelectingTargetFor] = useState<number | null>(null)

  useEffect(() => {
    getLayer1Template(companyId, statementType)
      .then(tmpl => {
        if (tmpl) {
          setRows([...tmpl.rows])
          setWaterfall(statementType === 'income_statement' ? (tmpl.waterfall ?? []) : null)
        }
        setLoading(false)
      })
      .catch(err => {
        setError(getErrorMessage(err, 'Failed to load template.'))
        setLoading(false)
      })
  }, [companyId, statementType])

  function nextId(currentRows: Layer1TemplateRow[]): number {
    const allIds: number[] = []
    function walk(rs: Layer1TemplateRow[]) {
      for (const r of rs) { allIds.push(r.id); walk(r.children) }
    }
    walk(currentRows)
    return Math.max(0, ...allIds) + 1
  }

  function setAction(index: number, action: NewItemAction) {
    setActionsState(prev => ({ ...prev, [index]: action }))
  }

  function handleTreeChange(newRows: Layer1TemplateRow[], newWaterfall: WaterfallStep[] | null) {
    setRows(newRows)
    setWaterfall(newWaterfall)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      let updatedRows = [...rows]
      for (let i = 0; i < unmatchedItems.length; i++) {
        const item = unmatchedItems[i]
        const action = actions[i]
        if (!action) continue
        if (action.kind === 'add') {
          updatedRows = [...updatedRows, {
            ...item,
            id: nextId(updatedRows),
            type: action.type,
            children: [],
          }]
        }
        // 'map' to existing: item already represented in template — skip
      }
      const template: Layer1Template = {
        meta: { statement_type: statementType, created_at: new Date().toISOString() },
        rows: updatedRows,
        ...(waterfall !== null ? { waterfall } : {}),
      }
      await saveLayer1Template(companyId, statementType, template)
      onSaved()
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to save template.'))
    } finally {
      setSaving(false)
    }
  }

  return {
    rows,
    waterfall,
    loading,
    error,
    saving,
    actions,
    selectingTargetFor,
    setSelectingTargetFor,
    setAction,
    handleTreeChange,
    handleSave,
  }
}
