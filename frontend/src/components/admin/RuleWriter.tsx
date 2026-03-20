import { useState } from 'react'
import { Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { adminWriteRule, WriteRuleResult } from './AdminApiClient'

interface Props {
  companyId: number
  selectedField: { name: string; statementType: string } | null
  onRuleApplied: (updatedMarkdown: string) => void
}

export default function RuleWriter({ companyId, selectedField, onRuleApplied }: Props) {
  const [ruleText, setRuleText] = useState('')
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<WriteRuleResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!selectedField || !ruleText.trim()) return
    setProcessing(true)
    setResult(null)
    setError(null)
    try {
      const res = await adminWriteRule({
        company_id: companyId,
        field_name: selectedField.name,
        statement_type: selectedField.statementType,
        rule_text: ruleText.trim(),
      })
      setResult(res)
      if (res.updated_markdown) onRuleApplied(res.updated_markdown)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setProcessing(false)
    }
  }

  if (!selectedField) {
    return (
      <div className="flex items-center justify-center h-full text-[12px] text-muted-foreground px-4 text-center">
        Click a template field to write a rule
      </div>
    )
  }

  const actionColor = result?.layer_b_action === 'APPEND' ? 'emerald'
    : result?.layer_b_action === 'AMEND' ? 'blue'
    : result?.layer_b_action === 'DISCARD' ? 'gray'
    : 'amber'

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border bg-gray-50 shrink-0">
        <span className="text-[11px]" style={{ fontWeight: 500 }}>Rule Writer</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div>
          <p className="text-[11px] text-muted-foreground mb-0.5">Field</p>
          <p className="text-[13px]" style={{ fontWeight: 500 }}>{selectedField.name}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {selectedField.statementType === 'income_statement' ? 'Income Statement' : 'Balance Sheet'}
          </p>
        </div>

        <div>
          <label className="text-[11px] text-muted-foreground block mb-1">Rule</label>
          <textarea
            className="w-full border border-border rounded-lg p-2 text-[12px] resize-none outline-none focus:ring-2 focus:ring-primary/20 font-mono"
            rows={5}
            placeholder="Write a classification rule for this field..."
            value={ruleText}
            onChange={(e) => setRuleText(e.target.value)}
            disabled={processing}
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={processing || !ruleText.trim()}
          className="w-full py-2 rounded-lg text-[13px] disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          style={{ backgroundColor: '#030213', color: 'white', fontWeight: 500 }}
        >
          {processing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {processing ? 'Processing...' : 'Submit via Layer A/B'}
        </button>

        {error && (
          <div className="flex items-start gap-1.5 p-2 bg-red-50 rounded-lg">
            <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
            <p className="text-[12px] text-red-600">{error}</p>
          </div>
        )}

        {result && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              <span className={`text-[11px] px-1.5 py-0.5 rounded font-mono bg-${actionColor}-50 text-${actionColor}-700`} style={{ fontWeight: 600 }}>
                {result.layer_b_action}
              </span>
              {result.layer_b_detail && (
                <span className="text-[11px] text-muted-foreground">{result.layer_b_detail}</span>
              )}
            </div>
            <div className="bg-gray-50 rounded-lg p-2">
              <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide" style={{ fontWeight: 600 }}>Layer A Instruction</p>
              <p className="text-[12px]">{result.layer_a_instruction}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
