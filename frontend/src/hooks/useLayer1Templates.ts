/**
 * useLayer1Templates — owns all state and logic for the L1 Templates admin tab.
 *
 * Hides:
 *   - 7 Partial<Record<StmtTab, T>> state maps: templates, rows, waterfalls,
 *     loading, saving, errors, saved
 *   - Parallel fetch useEffect (all 3 statement types on mount)
 *   - handleChange — updates rows + waterfalls, resets saved flag
 *   - handleSave — assembles Layer1Template object, persists, manages saving/saved/errors
 *   - Derived: isLoading, stmtRows, stmtWaterfall, hasTemplate for activeStmt
 */
import { useEffect, useState } from 'react'
import { getLayer1Template, saveLayer1Template } from '../api/client'
import type { Layer1Template, Layer1TemplateRow, WaterfallStep, StatementType } from '../types'
import { ALL_STATEMENT_TYPES, createStmtRecord } from '../utils/statementMeta'
import { getErrorMessage } from '../utils/errorUtils'

export type StmtTab = StatementType

const ALL_STMTS = ALL_STATEMENT_TYPES

interface UseLayer1TemplatesOptions {
  companyId: number
}

export function useLayer1Templates({ companyId }: UseLayer1TemplatesOptions) {
  const [activeStmt, setActiveStmt] = useState<StmtTab>('income_statement')
  const [rows, setRows] = useState<Partial<Record<StmtTab, Layer1TemplateRow[]>>>({})
  const [waterfalls, setWaterfalls] = useState<Partial<Record<StmtTab, WaterfallStep[] | null>>>({})
  const [loading, setLoading] = useState<Partial<Record<StmtTab, boolean>>>({})
  const [saving, setSaving] = useState<Partial<Record<StmtTab, boolean>>>({})
  const [errors, setErrors] = useState<Partial<Record<StmtTab, string>>>({})
  const [saved, setSaved] = useState<Partial<Record<StmtTab, boolean>>>({})

  useEffect(() => {
    setLoading(createStmtRecord(true))
    ALL_STMTS.forEach((stmt) => {
      getLayer1Template(companyId, stmt)
        .then((tmpl) => {
          if (tmpl) {
            setRows((prev) => ({ ...prev, [stmt]: tmpl.rows }))
            setWaterfalls((prev) => ({
              ...prev,
              [stmt]: stmt === 'income_statement' ? (tmpl.waterfall ?? []) : null,
            }))
          }
        })
        .catch(() => {})
        .finally(() => setLoading((prev) => ({ ...prev, [stmt]: false })))
    })
  }, [companyId])

  function handleChange(stmt: StmtTab, newRows: Layer1TemplateRow[], newWaterfall: WaterfallStep[] | null) {
    setRows((prev) => ({ ...prev, [stmt]: newRows }))
    setWaterfalls((prev) => ({ ...prev, [stmt]: newWaterfall }))
    setSaved((prev) => ({ ...prev, [stmt]: false }))
  }

  async function handleSave(stmt: StmtTab) {
    const stmtRows = rows[stmt]
    if (!stmtRows) return
    setSaving((prev) => ({ ...prev, [stmt]: true }))
    setErrors((prev) => ({ ...prev, [stmt]: undefined }))
    try {
      const tmpl: Layer1Template = {
        meta: { statement_type: stmt, created_at: new Date().toISOString() },
        rows: stmtRows,
        ...(stmt === 'income_statement' && waterfalls[stmt] !== null
          ? { waterfall: waterfalls[stmt] ?? [] }
          : {}),
      }
      await saveLayer1Template(companyId, stmt, tmpl)
      setSaved((prev) => ({ ...prev, [stmt]: true }))
      setTimeout(() => setSaved((prev) => ({ ...prev, [stmt]: false })), 2000)
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [stmt]: getErrorMessage(err, 'Save failed.'),
      }))
    } finally {
      setSaving((prev) => ({ ...prev, [stmt]: false }))
    }
  }

  const isLoading = !!loading[activeStmt]
  const stmtRows = rows[activeStmt]
  const stmtWaterfall = waterfalls[activeStmt] ?? null
  const hasTemplate = !!stmtRows

  return {
    activeStmt,
    setActiveStmt,
    rows,
    saving,
    errors,
    saved,
    isLoading,
    stmtRows,
    stmtWaterfall,
    hasTemplate,
    handleChange,
    handleSave,
  }
}
