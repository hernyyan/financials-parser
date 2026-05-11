import { useState, useEffect } from 'react'
import { Save, Trash2 } from 'lucide-react'
import { CALCULATED_FIELDS } from '../../utils/templateStyling'
import type { Correction } from '../../types'

const TAG_OPTIONS: { value: Correction['tag']; label: string; description: string }[] = [
  { value: 'one_off_error', label: 'One-off Error', description: 'Isolated mistake, no further action' },
  { value: 'company_specific', label: 'Company-specific', description: 'Pattern unique to this company, saved for future' },
  { value: 'general_fix', label: 'General Fix', description: 'Systematic issue, logged for review' },
]

interface CorrectionFormProps {
  fieldName: string
  currentValue: number | null
  existingCorrection?: Correction
  isCalculated: boolean
  onSave: (correction: Omit<Correction, 'timestamp'>) => void
  onRemove: (fieldName: string) => void
  onLiveEdit?: (fieldName: string, value: number | null) => void
}

export default function CorrectionForm({
  fieldName,
  currentValue,
  existingCorrection,
  isCalculated,
  onSave,
  onRemove,
  onLiveEdit,
}: CorrectionFormProps) {
  const [correctedValue, setCorrectedValue] = useState<string>('')
  const [correctionReasoning, setCorrectionReasoning] = useState('')
  const [tag, setTag] = useState<Correction['tag']>('one_off_error')
  const [reasoningError, setReasoningError] = useState(false)

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
    setReasoningError(false)
  }, [fieldName, currentValue, existingCorrection])

  function handleSave() {
    const parsed = parseFloat(correctedValue)
    if (isNaN(parsed)) return
    if (!correctionReasoning.trim()) { setReasoningError(true); return }
    setReasoningError(false)
    onSave({ fieldName, originalValue: currentValue ?? 0, correctedValue: parsed, reasoning: correctionReasoning, tag })
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave() }
  }

  return (
    <div className="px-4 py-3 space-y-3">
      <h4 className="text-[12px]" style={{ fontWeight: 500 }}>Submit Correction</h4>

      <div>
        <label className="text-[11px] text-muted-foreground block mb-1">Corrected Value</label>
        <input
          type="number"
          step="any"
          value={correctedValue}
          onChange={(e) => {
            setCorrectedValue(e.target.value)
            const parsed = parseFloat(e.target.value)
            onLiveEdit?.(fieldName, isNaN(parsed) ? null : parsed)
          }}
          onKeyDown={handleKeyDown}
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
          className={`w-full bg-white border rounded-lg px-3 py-2 text-[12px] resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 ${reasoningError ? 'border-red-400' : 'border-border'}`}
          placeholder="Explain why this value should be corrected..."
        />
        {reasoningError && (
          <p className="text-[10px] text-red-500 mt-1">Reasoning is required for all corrections.</p>
        )}
      </div>

      <div>
        <label className="text-[11px] text-muted-foreground block mb-2">Correction Type</label>
        <div className="space-y-2">
          {TAG_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex items-start gap-2.5 p-2 rounded-lg border cursor-pointer transition-colors ${
                tag === opt.value ? 'border-primary bg-blue-50/50' : 'border-gray-200 hover:border-gray-300'
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

      {existingCorrection && !CALCULATED_FIELDS.has(fieldName) && (
        <button
          onClick={() => onRemove(fieldName)}
          className="w-full text-red-600 hover:text-red-700 py-1.5 text-[12px] flex items-center justify-center gap-1.5 transition-colors"
        >
          <Trash2 className="w-3 h-3" />
          Remove Correction
        </button>
      )}
    </div>
  )
}
