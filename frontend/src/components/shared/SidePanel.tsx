import { useState } from 'react'
import type { Layer2Result, Correction, ValidationCheck, CalculationMeta, StatementType } from '../../types'
import { STATEMENT_LABELS } from '../../utils/statementMeta'
import { formatFieldValue } from '../../utils/formatters'
import { CALCULATED_FIELDS, READONLY_FIELDS } from '../../utils/templateStyling'
import CalculatedFieldPanel from './CalculatedFieldPanel'
import CorrectionForm from './CorrectionForm'
import ValidationChecksPanel from './ValidationChecksPanel'
import { X, ChevronDown, ChevronRight } from 'lucide-react'

interface SidePanelProps {
  isOpen: boolean
  fieldName: string | null
  statementType: StatementType | null
  layer2Result: Layer2Result | null
  existingCorrection?: Correction
  onClose: () => void
  onSaveCorrection: (correction: Omit<Correction, 'timestamp'>) => void
  onRemoveCorrection: (fieldName: string) => void
  onLiveEdit?: (fieldName: string, value: number | null, isOverride: boolean) => void
  sourceSheet?: string | null
}


function highlightDollarAmounts(text: string): React.ReactNode {
  const parts = text.split(/(\(\$[\d,]+(?:\.\d{1,2})?\)|\$[\d,]+(?:\.\d{1,2})?)/g)
  return parts.map((part, i) => {
    if (/^\$[\d,]/.test(part) || /^\(\$[\d,]/.test(part)) {
      return (
        <span key={i} className="text-primary bg-blue-50 px-0.5 rounded" style={{ fontWeight: 600 }}>
          {part}
        </span>
      )
    }
    return part
  })
}


// ─── Main SidePanel ────────────────────────────────────────────────────────────

export default function SidePanel({
  isOpen,
  fieldName,
  statementType,
  layer2Result,
  existingCorrection,
  sourceSheet,
  onClose,
  onSaveCorrection,
  onRemoveCorrection,
  onLiveEdit,
}: SidePanelProps) {
  const isCalculated = fieldName ? CALCULATED_FIELDS.has(fieldName) : false
  const isReadonly = fieldName ? READONLY_FIELDS.has(fieldName) : false

  const currentValue =
    fieldName && layer2Result ? (layer2Result.values[fieldName] ?? null) : null

  const reasoning =
    fieldName && layer2Result ? (layer2Result.reasoning[fieldName] ?? null) : null

  const meta: CalculationMeta | undefined =
    fieldName && layer2Result?.calculationMeta
      ? layer2Result.calculationMeta[fieldName]
      : undefined

  const relevantCheckNames: string[] =
    fieldName && layer2Result?.fieldValidations
      ? (layer2Result.fieldValidations[fieldName] ?? [])
      : []

  const relevantChecks: [string, ValidationCheck][] = relevantCheckNames
    .map((name): [string, ValidationCheck | undefined] => [name, layer2Result?.validation[name]])
    .filter((pair): pair is [string, ValidationCheck] => pair[1] !== undefined)

  const hasFailure = relevantChecks.some(([, check]) => check.status === 'FAIL')
  const passCount = relevantChecks.filter(([, c]) => c.status === 'PASS').length

  const [reasoningOpen, setReasoningOpen] = useState(true)

  function handleSaveOverride(value: number, reasoning: string) {
    if (!fieldName) return
    onSaveCorrection({
      fieldName,
      originalValue: currentValue ?? 0,
      correctedValue: value,
      reasoning,
      tag: 'one_off_error',
    })
  }

  function handleClearOverride() {
    if (!fieldName) return
    onRemoveCorrection(fieldName)
  }

  if (!isOpen || !fieldName) return null

  return (
    <div
      key={fieldName}
      className="w-[400px] border-l border-border bg-white flex flex-col shrink-0 overflow-hidden animate-fadeIn"
    >
      {/* Header */}
      <div className="flex items-start justify-between px-4 py-3 border-b border-border shrink-0">
        <div>
          {statementType && (
            <p className="text-[11px] text-muted-foreground mb-0.5">{statementType ? STATEMENT_LABELS[statementType] : ''}</p>
          )}
          <div className="flex items-center gap-2">
            <h3 className="text-[14px]" style={{ fontWeight: 600 }}>{fieldName}</h3>
            {isCalculated && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700" style={{ fontWeight: 500 }}>
                Calculated
              </span>
            )}
          </div>
          {sourceSheet && (
            <p style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
              Source: {sourceSheet}
            </p>
          )}
        </div>
        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded transition-colors mt-0.5">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Current value */}
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[11px] text-muted-foreground mb-1">
            {isCalculated ? 'Calculated Value' : 'Classified Value'}
          </p>
          {existingCorrection ? (
            <div>
              <p className="text-[20px] font-mono line-through text-muted-foreground" style={{ fontWeight: 600 }}>
                {formatFieldValue(fieldName, currentValue)}
              </p>
              <p className="text-[12px] text-amber-600 mt-1" style={{ fontWeight: 500 }}>
                {fieldName && CALCULATED_FIELDS.has(fieldName) ? 'Overridden to:' : 'Corrected to:'}{' '}
                {formatFieldValue(fieldName, existingCorrection.correctedValue)}
              </p>
            </div>
          ) : (
            <p
              className={`text-[20px] font-mono ${currentValue !== null && currentValue < 0 ? 'text-red-600' : 'text-foreground'}`}
              style={{ fontWeight: 600 }}
            >
              {formatFieldValue(fieldName, currentValue)}
            </p>
          )}
        </div>

        {/* Calculated field panel */}
        {isCalculated ? (
          <CalculatedFieldPanel
            fieldName={fieldName}
            meta={meta}
            existingCorrection={existingCorrection}
            isReadonly={isReadonly}
            onSaveOverride={handleSaveOverride}
            onClearOverride={handleClearOverride}
            onLiveEdit={onLiveEdit ? (v) => onLiveEdit(fieldName, v, true) : undefined}
          />
        ) : (
          <>
            {/* AI Reasoning — collapsible */}
            <div className="border-b border-border">
              <button
                onClick={() => setReasoningOpen((o) => !o)}
                className="flex items-center justify-between w-full px-4 py-2.5 hover:bg-gray-50 transition-colors"
              >
                <span className="text-[12px]" style={{ fontWeight: 500 }}>AI Reasoning</span>
                {reasoningOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </button>
              {reasoningOpen && (
                <div className="px-4 pb-3 text-[12px] text-muted-foreground leading-relaxed">
                  {reasoning ? (
                    <p className="whitespace-pre-wrap">{highlightDollarAmounts(reasoning)}</p>
                  ) : (
                    <p className="italic">No source data mapped to this field.</p>
                  )}
                </div>
              )}
            </div>

            {/* Validation Checks — collapsible */}
            <ValidationChecksPanel checks={relevantChecks} passCount={passCount} />

            {/* Correction form */}
            <CorrectionForm
              fieldName={fieldName}
              currentValue={currentValue}
              existingCorrection={existingCorrection}
              isCalculated={isCalculated}
              onSave={onSaveCorrection}
              onRemove={onRemoveCorrection}
              onLiveEdit={onLiveEdit ? (fn, v) => onLiveEdit(fn, v, false) : undefined}
            />
          </>
        )}
      </div>
    </div>
  )
}
