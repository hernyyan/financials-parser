/**
 * SidePanel — slides in when the user clicks an L2 template row.
 *
 * Shows three values per field:
 *   1. Live value (top, big) — manual override if set, else formula value.
 *   2. Formula value + formula expression + "Edit Formula" button.
 *   3. Python check value + orange flag if it differs from formula value.
 *
 * Manual override is independent of formula: the user can enter any number
 * without touching the formula. If no manual override is set, changing the
 * formula automatically updates the live value.
 */
import { useState, useEffect } from 'react'
import { X, AlertTriangle, Edit2, Check } from 'lucide-react'
import type { Layer2Result, L2Formula } from '../../types'
import { formatFieldValue } from '../../utils/formatters'
import { buildL1ValueMap, calculateFormulaValue, formatFormula } from '../../utils/formulaCalculation'
import FormulaEditor from '../../components/wizard/FormulaEditor'
import type { Layer1TemplateRow } from '../../types'

interface SidePanelProps {
  isOpen: boolean
  fieldName: string | null
  statementType: 'income_statement' | 'balance_sheet' | 'cash_flow_statement' | null
  layer2Result: Layer2Result | null
  /** Manual override for this field (null = cleared) */
  manualOverride?: number | null
  /** Current formula for this field */
  formula?: L2Formula
  /** L1 structured rows for this statement (for FormulaEditor validation) */
  layer1Rows?: Layer1TemplateRow[]
  onClose: () => void
  onFormulaChange: (fieldName: string, formula: L2Formula) => void
  onManualOverrideChange: (fieldName: string, value: number | null) => void
  /** Legacy: kept for compatibility with useCorrections hook */
  onSaveCorrection?: (correction: { fieldName: string; originalValue: number; correctedValue: number; reasoning?: string; tag: string }) => void
  onRemoveCorrection?: (fieldName: string) => void
  sourceSheet?: string | null
}

function fmt(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const abs = Math.abs(value)
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return value < 0 ? `(${s})` : s
}

function statementLabel(type: string | null): string {
  if (type === 'income_statement') return 'Income Statement'
  if (type === 'balance_sheet') return 'Balance Sheet'
  if (type === 'cash_flow_statement') return 'Cash Flow Statement'
  return ''
}

const TOLERANCE = 1.0

export default function SidePanel({
  isOpen,
  fieldName,
  statementType,
  layer2Result,
  manualOverride,
  formula,
  layer1Rows = [],
  onClose,
  onFormulaChange,
  onManualOverrideChange,
  sourceSheet,
}: SidePanelProps) {
  const [editingFormula, setEditingFormula] = useState(false)
  const [overrideInput, setOverrideInput] = useState('')

  // Build L1 value map once per open
  const l1ValueMap = buildL1ValueMap(layer1Rows)

  // Compute formula value from current formula + L1 data
  const formulaValue = formula && formula.length > 0
    ? calculateFormulaValue(formula, l1ValueMap)
    : (layer2Result?.formulaValues?.[fieldName ?? ''] ?? null)

  // Python check value
  const pythonCheckValue = fieldName
    ? (layer2Result?.pythonCheckValues?.[fieldName] ?? null)
    : null

  const isPythonFlagged = fieldName
    ? (layer2Result?.pythonFlaggedFields ?? []).includes(fieldName)
    : false

  // Live value: manual override if set, else formula value
  const hasManualOverride = manualOverride !== null && manualOverride !== undefined
  const liveValue = hasManualOverride ? manualOverride : formulaValue

  // Reset local state when field changes
  useEffect(() => {
    setEditingFormula(false)
    setOverrideInput(hasManualOverride ? String(manualOverride) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldName])

  function handleSaveOverride() {
    if (!fieldName) return
    const parsed = parseFloat(overrideInput)
    if (isNaN(parsed)) return
    onManualOverrideChange(fieldName, parsed)
  }

  function handleClearOverride() {
    if (!fieldName) return
    onManualOverrideChange(fieldName, null)
    setOverrideInput(formulaValue !== null ? String(formulaValue) : '')
  }

  function handleFormulaSave(newFormula: L2Formula) {
    if (!fieldName) return
    onFormulaChange(fieldName, newFormula)
    setEditingFormula(false)
    // If no manual override, update input to show new formula value
    if (!hasManualOverride) {
      const newVal = calculateFormulaValue(newFormula, l1ValueMap)
      setOverrideInput(newVal !== null ? String(newVal) : '')
    }
  }

  if (!isOpen || !fieldName) return null

  const currentFormula = formula ?? []
  const formulaDisplay = currentFormula.length > 0 ? formatFormula(currentFormula) : null

  return (
    <div
      key={fieldName}
      className="w-[400px] border-l border-border bg-white flex flex-col shrink-0 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-start justify-between px-4 py-3 border-b border-border shrink-0">
        <div>
          {statementType && (
            <p className="text-[11px] text-muted-foreground mb-0.5">{statementLabel(statementType)}</p>
          )}
          <h3 className="text-[14px]" style={{ fontWeight: 600 }}>{fieldName}</h3>
          {sourceSheet && (
            <p className="text-[11px] text-muted-foreground mt-0.5">Source: {sourceSheet}</p>
          )}
        </div>
        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded transition-colors mt-0.5">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── Live value ───────────────────────────────────────────────────── */}
        <div className="px-4 py-4 border-b border-border">
          <p className="text-[11px] text-muted-foreground mb-1">Value in template</p>
          <div className="flex items-center gap-2">
            <p
              className={`text-[24px] font-mono ${liveValue !== null && liveValue < 0 ? 'text-red-600' : 'text-foreground'}`}
              style={{ fontWeight: 700 }}
            >
              {fmt(liveValue)}
            </p>
            {hasManualOverride && (
              <button
                onClick={handleClearOverride}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-amber-100 text-amber-800 hover:bg-amber-200 transition-colors"
                style={{ fontWeight: 500 }}
              >
                User Corrected
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* ── Formula value ─────────────────────────────────────────────────── */}
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[11px] text-muted-foreground mb-2" style={{ fontWeight: 500 }}>Formula</p>

          {editingFormula ? (
            <FormulaEditor
              initialFormula={currentFormula}
              l1ValueMap={l1ValueMap}
              onSave={handleFormulaSave}
              onCancel={() => setEditingFormula(false)}
            />
          ) : (
            <>
              {formulaDisplay ? (
                <p className="text-[12px] font-mono text-slate-700 break-words mb-1">{formulaDisplay}</p>
              ) : (
                <p className="text-[12px] text-slate-400 italic mb-1">No formula configured</p>
              )}
              <p className="text-[14px] font-mono text-slate-600 mb-2" style={{ fontWeight: 600 }}>
                {fmt(formulaValue)}
              </p>
              <button
                onClick={() => setEditingFormula(true)}
                className="flex items-center gap-1.5 text-[12px] text-slate-600 hover:text-slate-800 px-2 py-1 rounded border border-slate-300 hover:border-slate-400 transition-colors"
              >
                <Edit2 className="w-3 h-3" />
                Edit Formula
              </button>
            </>
          )}
        </div>

        {/* ── Python check ─────────────────────────────────────────────────── */}
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[11px] text-muted-foreground mb-2" style={{ fontWeight: 500 }}>Python check (L2-to-L2)</p>
          <div className="flex items-center gap-2">
            <p className="text-[14px] font-mono text-slate-600" style={{ fontWeight: 600 }}>
              {fmt(pythonCheckValue)}
            </p>
            {isPythonFlagged && pythonCheckValue !== null && (
              <span className="flex items-center gap-1 text-[11px] text-orange-600" style={{ fontWeight: 500 }}>
                <AlertTriangle className="w-3.5 h-3.5" />
                Differs from formula
              </span>
            )}
            {!isPythonFlagged && pythonCheckValue !== null && formulaValue !== null && (
              <span className="flex items-center gap-1 text-[11px] text-emerald-600" style={{ fontWeight: 500 }}>
                <Check className="w-3.5 h-3.5" />
                Matches
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-400 mt-1">Computed from other L2 field values — for reference only</p>
        </div>

        {/* ── Manual override ───────────────────────────────────────────────── */}
        <div className="px-4 py-3">
          <p className="text-[11px] text-muted-foreground mb-2" style={{ fontWeight: 500 }}>Manual override</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="any"
              value={overrideInput}
              onChange={e => setOverrideInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSaveOverride() }}
              className="flex-1 border border-border rounded px-2.5 py-1.5 text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="Enter value to override..."
            />
            <button
              onClick={handleSaveOverride}
              disabled={!overrideInput || isNaN(parseFloat(overrideInput))}
              className="px-3 py-1.5 text-[12px] rounded bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-40 transition-colors"
              style={{ fontWeight: 500 }}
            >
              Save
            </button>
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5">
            Overrides the formula value in the template. Use "× User Corrected" above to clear.
          </p>
        </div>
      </div>
    </div>
  )
}
