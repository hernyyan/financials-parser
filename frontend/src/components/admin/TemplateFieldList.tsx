import { getTemplate } from '../../api/client'
import { useEffect, useState } from 'react'
import { BOLD_FIELDS, ITALIC_FIELDS, isIndented } from '../../utils/templateStyling'
import type { TemplateResponse } from '../../types'

interface Props {
  contextContent: string
  selectedField: { name: string; statementType: string } | null
  onSelectField: (field: { name: string; statementType: string }) => void
}

export default function TemplateFieldList({ contextContent, selectedField, onSelectField }: Props) {
  const [template, setTemplate] = useState<TemplateResponse | null>(null)

  useEffect(() => {
    getTemplate().then(setTemplate).catch(console.error)
  }, [])

  function fieldHasRule(fieldName: string): boolean {
    return contextContent.toLowerCase().includes(fieldName.toLowerCase())
  }

  if (!template) return <div className="p-3 text-[12px] text-muted-foreground">Loading template...</div>

  const statements: { key: 'income_statement' | 'balance_sheet'; label: string }[] = [
    { key: 'income_statement', label: 'Income Statement' },
    { key: 'balance_sheet', label: 'Balance Sheet' },
  ]

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-3 py-2 border-b border-border bg-gray-50 shrink-0">
        <span className="text-[11px]" style={{ fontWeight: 500 }}>Template Fields</span>
      </div>
      {statements.map(({ key, label }) => {
        const sections = template[key]?.sections ?? []
        return (
          <div key={key}>
            <div className="px-3 py-1.5 bg-gray-100 border-b border-border">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wide" style={{ fontWeight: 600 }}>{label}</span>
            </div>
            {sections.map((section) => (
              <div key={section.header ?? '_'}>
                {section.header && (
                  <div className="px-3 py-1 bg-gray-50 border-b border-gray-100">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide" style={{ fontWeight: 600 }}>{section.header}</span>
                  </div>
                )}
                {section.fields.map((field) => {
                  const isSelected = selectedField?.name === field && selectedField?.statementType === key
                  const hasRule = fieldHasRule(field)
                  return (
                    <button
                      key={field}
                      onClick={() => onSelectField({ name: field, statementType: key })}
                      className={`w-full flex items-center justify-between py-1.5 text-left text-[12px] border-b border-gray-50 transition-colors ${
                        isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-foreground'
                      }`}
                      style={{ paddingLeft: isIndented(field) ? '1.5rem' : '1rem', paddingRight: '1rem' }}
                    >
                      <span
                        className={ITALIC_FIELDS.has(field) ? 'italic' : ''}
                        style={{ fontWeight: BOLD_FIELDS.has(field) ? 600 : 400 }}
                      >{field}</span>
                      {hasRule && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
