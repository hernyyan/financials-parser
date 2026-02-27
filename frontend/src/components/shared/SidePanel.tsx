import { useState, useEffect } from 'react'
import type { Layer2Result, Correction, ValidationCheck } from '../../types'
import { formatFieldValue } from '../../utils/formatters'

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
  { value: 'one_off_error', label: 'One-off Error', description: 'Isolated mistake in this report; no further action taken' },
  { value: 'company_specific', label: 'Company-specific', description: 'Consistent pattern for this company; queued for future reference' },
  { value: 'general_fix', label: 'General Fix', description: 'Systematic issue across all companies; logged to shared CSV' },
]

/** Wrap dollar amounts in reasoning text with a monospace span for readability. */
function highlightDollarAmounts(text: string): React.ReactNode {
  const parts = text.split(/(\(\$[\d,]+(?:\.\d{1,2})?\)|\$[\d,]+(?:\.\d{1,2})?)/g)
  return parts.map((part, i) => {
    if (/^\$[\d,]/.test(part) || /^\(\$[\d,]/.test(part)) {
      return (
        <span key={i} className="font-mono font-semibold text-gray-800">
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
  const failCount = relevantChecks.filter(([, c]) => c.status === 'FAIL').length

  // Correction form state
  const [correctedValue, setCorrectedValue] = useState<string>('')
  const [correctionReasoning, setCorrectionReasoning] = useState('')
  const [tag, setTag] = useState<Correction['tag']>('one_off_error')
  const [reasoningError, setReasoningError] = useState(false)

  // Collapsible section state
  const [reasoningOpen, setReasoningOpen] = useState(true)
  const [validationOpen, setValidationOpen] = useState(false)

  // Reset form and expand relevant sections when selected field changes
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

  return (
    <div
      className={`fixed top-0 right-0 h-screen w-96 flex flex-col bg-white border-l border-gray-200 shadow-xl z-50 transition-transform duration-200 ease-out ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {isOpen && fieldName && (
        /* key causes content to remount (fade-in) whenever a different field is selected */
        <div key={fieldName} className="flex flex-col h-full overflow-hidden animate-fadeIn">
          {/* Header */}
          <div className="flex items-start justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 flex-shrink-0">
            <div className="flex-1 min-w-0 pr-2">
              <h3 className="text-sm font-semibold text-gray-800 leading-tight">{fieldName}</h3>
              {statementType && (
                <span className="inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 font-medium">
                  {statementType === 'income_statement' ? 'Income Statement' : 'Balance Sheet'}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0 text-lg leading-none mt-0.5"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Current / corrected value */}
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                Classified Value
              </p>
              {existingCorrection ? (
                <div className="space-y-1">
                  <p className="text-sm text-gray-400 line-through">
                    {formatFieldValue(fieldName, currentValue)}
                  </p>
                  <p className="text-lg font-semibold text-blue-600 tabular-nums">
                    {formatFieldValue(fieldName, existingCorrection.correctedValue)}
                  </p>
                  <p className="text-[10px] text-blue-500">Manually corrected</p>
                </div>
              ) : (
                <p
                  className={`text-lg font-semibold tabular-nums ${
                    currentValue !== null && currentValue < 0 ? 'text-red-600' : 'text-gray-900'
                  }`}
                >
                  {formatFieldValue(fieldName, currentValue)}
                </p>
              )}
            </div>

            {/* Classification reasoning — collapsible */}
            <div className="border-b border-gray-100">
              <button
                onClick={() => setReasoningOpen((o) => !o)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
              >
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                  Classification Reasoning
                </p>
                <span className="text-gray-400 text-[10px]">{reasoningOpen ? '▲' : '▼'}</span>
              </button>
              {reasoningOpen && (
                <div className="px-4 pb-3">
                  {reasoning ? (
                    <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">
                      {highlightDollarAmounts(reasoning)}
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400 italic">
                      No source data mapped to this field.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Validation checks — collapsible */}
            <div className="border-b border-gray-100">
              <button
                onClick={() => setValidationOpen((o) => !o)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                    Validation Checks
                  </p>
                  {relevantChecks.length > 0 && (
                    <span
                      className={`text-[9px] px-1 py-0.5 rounded font-semibold ${
                        hasFailure ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'
                      }`}
                    >
                      {hasFailure ? `${failCount} FAIL` : 'ALL PASS'}
                    </span>
                  )}
                </div>
                <span className="text-gray-400 text-[10px]">{validationOpen ? '▲' : '▼'}</span>
              </button>
              {validationOpen && (
                <div className="px-4 pb-3">
                  {relevantChecks.length > 0 ? (
                    <div className="space-y-1.5">
                      {relevantChecks.map(([checkName, check]) => (
                        <div
                          key={checkName}
                          className={`rounded p-2 text-xs ${
                            check.status === 'PASS'
                              ? 'bg-green-50 border border-green-100'
                              : 'bg-red-50 border border-red-100'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-sm">{check.status === 'PASS' ? '✅' : '❌'}</span>
                            <span
                              className={`font-semibold text-[10px] ${
                                check.status === 'PASS' ? 'text-green-700' : 'text-red-700'
                              }`}
                            >
                              {check.status}
                            </span>
                          </div>
                          <p className="text-gray-600 text-[10px] font-medium mb-0.5">
                            {check.checkName}
                          </p>
                          <p className="text-gray-500">{check.details}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 italic">
                      No validation checks for this field.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Correction form */}
            <div className="px-4 py-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2.5">
                Make Correction
              </p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Corrected Value</label>
                  <input
                    type="number"
                    step="any"
                    value={correctedValue}
                    onChange={(e) => setCorrectedValue(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                    className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Enter corrected value"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">
                    Correction Reasoning{' '}
                    <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={correctionReasoning}
                    onChange={(e) => {
                      setCorrectionReasoning(e.target.value)
                      if (e.target.value.trim()) setReasoningError(false)
                    }}
                    rows={3}
                    className={`w-full border rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:border-transparent resize-none ${
                      reasoningError
                        ? 'border-red-400 focus:ring-red-400'
                        : 'border-gray-300 focus:ring-blue-500'
                    }`}
                    placeholder="Why is this value incorrect? What should it be based on?"
                  />
                  {reasoningError && (
                    <p className="text-[10px] text-red-500 mt-1">
                      Reasoning is required for all corrections.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-2">
                    Correction Type
                  </label>
                  <div className="space-y-2">
                    {TAG_OPTIONS.map((opt) => (
                      <label key={opt.value} className="flex items-start gap-2.5 cursor-pointer group">
                        <input
                          type="radio"
                          name="correction-tag"
                          value={opt.value}
                          checked={tag === opt.value}
                          onChange={() => setTag(opt.value)}
                          className="mt-0.5 accent-blue-600"
                        />
                        <div>
                          <p className="text-xs font-medium text-gray-700 group-hover:text-gray-900">{opt.label}</p>
                          <p className="text-[10px] text-gray-400 leading-tight">{opt.description}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-1.5 px-4 py-3 border-t border-gray-200 bg-gray-50 flex-shrink-0">
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-2 rounded transition-colors"
              >
                Save Correction
              </button>
              <button
                onClick={onClose}
                className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded hover:border-gray-400 transition-colors"
              >
                Cancel
              </button>
            </div>
            {existingCorrection && (
              <button
                onClick={() => onRemoveCorrection(fieldName)}
                className="text-xs text-red-500 hover:text-red-700 text-center py-1 transition-colors"
              >
                Remove correction (revert to original)
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
