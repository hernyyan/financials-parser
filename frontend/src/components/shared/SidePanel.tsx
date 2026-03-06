import { useState, useEffect } from 'react'
import type { Layer2Result, Correction, ValidationCheck } from '../../types'
import { formatFieldValue } from '../../utils/formatters'
import {
  X,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Save,
  Trash2,
} from 'lucide-react'

interface SidePanelProps {
  isOpen: boolean
  fieldName: string | null
  statementType: 'income_statement' | 'balance_sheet' | null
  layer2Result: Layer2Result | null
  existingCorrection?: Correction
  onClose: () => void
  onSaveCorrection: (correction: Omit<Correction, 'timestamp'>) => void
  onRemoveCorrection: (fieldName: string) => void
}

const TAG_OPTIONS: { value: Correction['tag']; label: string; description: string }[] = [
  { value: 'one_off_error', label: 'One-off Error', description: 'Isolated mistake, no further action' },
  { value: 'company_specific', label: 'Company-specific', description: 'Pattern unique to this company, saved for future' },
  { value: 'general_fix', label: 'General Fix', description: 'Systematic issue, logged for review' },
]

/** Highlight dollar amounts in reasoning text with blue-50 background. */
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

export default function SidePanel({
  isOpen,
  fieldName,
  statementType,
  layer2Result,
  existingCorrection,
  onClose,
  onSaveCorrection,
  onRemoveCorrection,
}: SidePanelProps) {
  const currentValue =
    fieldName && layer2Result ? (layer2Result.values[fieldName] ?? null) : null

  const reasoning =
    fieldName && layer2Result ? (layer2Result.reasoning[fieldName] ?? null) : null

  const relevantCheckNames: string[] =
    fieldName && layer2Result?.fieldValidations
      ? (layer2Result.fieldValidations[fieldName] ?? [])
      : []

  const relevantChecks: [string, ValidationCheck][] = relevantCheckNames
    .map((name): [string, ValidationCheck | undefined] => [name, layer2Result?.validation[name]])
    .filter((pair): pair is [string, ValidationCheck] => pair[1] !== undefined)

  const hasFailure = relevantChecks.some(([, check]) => check.status === 'FAIL')
  const passCount = relevantChecks.filter(([, c]) => c.status === 'PASS').length

  // Correction form state
  const [correctedValue, setCorrectedValue] = useState<string>('')
  const [correctionReasoning, setCorrectionReasoning] = useState('')
  const [tag, setTag] = useState<Correction['tag']>('one_off_error')
  const [reasoningError, setReasoningError] = useState(false)

  // Collapsible section state
  const [reasoningOpen, setReasoningOpen] = useState(true)
  const [validationOpen, setValidationOpen] = useState(false)

  // Reset form when selected field changes
  useEffect(() => {
    if (existingCorrection) {
      setCorrectedValue(String(existingCorrection.correctedValue))
      setCorrectionReasoning(existingCorrection.reasoning ?? '')
      setTag(existingCorrection.tag)
    } else if (currentValue !== null && currentValue !== undefined) {
      setCorrectedValue(String(currentValue))
      setCorrectionReasoning('')
      setTag('one_off_error')
    } else {
      setCorrectedValue('')
      setCorrectionReasoning('')
      setTag('one_off_error')
    }
    setReasoningOpen(true)
    setValidationOpen(hasFailure)
    setReasoningError(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldName, currentValue, existingCorrection])

  function handleSave() {
    if (!fieldName) return
    const parsed = parseFloat(correctedValue)
    if (isNaN(parsed)) return
    if (!correctionReasoning.trim()) {
      setReasoningError(true)
      return
    }
    setReasoningError(false)
    onSaveCorrection({
      fieldName,
      originalValue: currentValue ?? 0,
      correctedValue: parsed,
      reasoning: correctionReasoning,
      tag,
    })
  }

  function handleInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSave()
    }
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
            <p className="text-[11px] text-muted-foreground mb-0.5">
              {statementType === 'income_statement' ? 'Income Statement' : 'Balance Sheet'}
            </p>
          )}
          <h3 className="text-[14px]" style={{ fontWeight: 600 }}>{fieldName}</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-100 rounded transition-colors mt-0.5"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Current value */}
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[11px] text-muted-foreground mb-1">Classified Value</p>
          {existingCorrection ? (
            <div>
              <p
                className="text-[20px] font-mono line-through text-muted-foreground"
                style={{ fontWeight: 600 }}
              >
                {formatFieldValue(fieldName, currentValue)}
              </p>
              <p className="text-[12px] text-amber-600 mt-1" style={{ fontWeight: 500 }}>
                Corrected to: {formatFieldValue(fieldName, existingCorrection.correctedValue)}
              </p>
            </div>
          ) : (
            <p
              className={`text-[20px] font-mono ${
                currentValue !== null && currentValue < 0 ? 'text-red-600' : 'text-foreground'
              }`}
              style={{ fontWeight: 600 }}
            >
              {formatFieldValue(fieldName, currentValue)}
            </p>
          )}
        </div>

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
        {relevantChecks.length > 0 && (
          <div className="border-b border-border">
            <button
              onClick={() => setValidationOpen((o) => !o)}
              className="flex items-center justify-between w-full px-4 py-2.5 hover:bg-gray-50 transition-colors"
            >
              <span className="text-[12px]" style={{ fontWeight: 500 }}>
                Validation Checks ({passCount}/{relevantChecks.length} passed)
              </span>
              {validationOpen ? (
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
              )}
            </button>
            {validationOpen && (
              <div className="px-4 pb-3 space-y-2">
                {relevantChecks.map(([checkName, check]) => (
                  <div
                    key={checkName}
                    className={`rounded-lg px-3 py-2 text-[11px] ${
                      check.status === 'PASS' ? 'bg-emerald-50' : 'bg-red-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      {check.status === 'PASS' ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                      ) : (
                        <XCircle className="w-3 h-3 text-red-500 shrink-0" />
                      )}
                      <span
                        style={{ fontWeight: 500 }}
                        className={check.status === 'PASS' ? 'text-emerald-700' : 'text-red-700'}
                      >
                        {check.checkName}
                      </span>
                    </div>
                    <p className={`ml-[18px] ${check.status === 'PASS' ? 'text-emerald-600' : 'text-red-600'}`}>
                      {check.details}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Correction form */}
        <div className="px-4 py-3 space-y-3">
          <h4 className="text-[12px] flex items-center gap-1.5" style={{ fontWeight: 500 }}>
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            Submit Correction
          </h4>

          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">Corrected Value</label>
            <input
              type="number"
              step="any"
              value={correctedValue}
              onChange={(e) => setCorrectedValue(e.target.value)}
              onKeyDown={handleInputKeyDown}
              className="w-full bg-white border border-border rounded-lg px-3 py-2 text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="Enter corrected value"
            />
          </div>

          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">
              Reasoning <span className="text-red-500">*</span>
            </label>
            <textarea
              value={correctionReasoning}
              onChange={(e) => {
                setCorrectionReasoning(e.target.value)
                if (e.target.value.trim()) setReasoningError(false)
              }}
              rows={3}
              className={`w-full bg-white border rounded-lg px-3 py-2 text-[12px] resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 ${
                reasoningError ? 'border-red-400' : 'border-border'
              }`}
              placeholder="Explain why this value should be corrected..."
            />
            {reasoningError && (
              <p className="text-[10px] text-red-500 mt-1">
                Reasoning is required for all corrections.
              </p>
            )}
          </div>

          <div>
            <label className="text-[11px] text-muted-foreground block mb-2">Correction Type</label>
            <div className="space-y-2">
              {TAG_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-2.5 p-2 rounded-lg border cursor-pointer transition-colors ${
                    tag === opt.value
                      ? 'border-primary bg-blue-50/50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="correction-tag"
                    value={opt.value}
                    checked={tag === opt.value}
                    onChange={() => setTag(opt.value)}
                    className="mt-0.5 accent-blue-600"
                  />
                  <div>
                    <p className="text-[12px]" style={{ fontWeight: 500 }}>{opt.label}</p>
                    <p className="text-[11px] text-muted-foreground">{opt.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <button
            onClick={handleSave}
            className="w-full bg-primary text-white py-2 rounded-lg text-[13px] hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
            style={{ fontWeight: 500 }}
          >
            <Save className="w-3.5 h-3.5" />
            Save Correction
          </button>

          {existingCorrection && (
            <button
              onClick={() => onRemoveCorrection(fieldName)}
              className="w-full text-red-600 hover:text-red-700 py-1.5 text-[12px] flex items-center justify-center gap-1.5 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              Remove Correction
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
