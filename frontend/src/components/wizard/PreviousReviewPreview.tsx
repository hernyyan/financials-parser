import { useEffect, useState } from 'react'
import { getTemplate } from '../../api/client'
import DataTable from '../shared/DataTable'
import { formatFieldValue } from '../../utils/formatters'
import { BOLD_FIELDS, ITALIC_FIELDS, isIndented } from '../../utils/templateStyling'
import type { Layer1Result, Layer1TemplateRow, Layer2Result, TemplateResponse, TemplateSection } from '../../types'
import { ArrowLeft, Upload } from 'lucide-react'

const STMT_KEYS = ['income_statement', 'balance_sheet', 'cash_flow_statement'] as const
type StmtKey = typeof STMT_KEYS[number]

const STMT_LABELS: Record<StmtKey, string> = {
  income_statement: 'Income Statement',
  balance_sheet: 'Balance Sheet',
  cash_flow_statement: 'Cash Flow Statement',
}

function formatSourceValue(value: number): string {
  if (value === 0) return '—'
  const abs = Math.abs(value)
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return value < 0 ? `(${formatted})` : formatted
}

function flattenStructuredRows(
  rows: Layer1TemplateRow[],
  depth: number,
  out: React.ComponentProps<typeof DataTable>['rows'],
): void {
  for (const row of rows) {
    out.push({
      label: row.label,
      value: row.value != null ? formatSourceValue(row.value) : null,
      isBold: row.type === 'sum',
      indentLevel: depth,
    })
    if (row.children?.length) flattenStructuredRows(row.children, depth + 1, out)
  }
}

function buildL1Rows(layer1Data: Record<string, Layer1Result>): React.ComponentProps<typeof DataTable>['rows'] {
  const rows: React.ComponentProps<typeof DataTable>['rows'] = []
  for (const [key, result] of Object.entries(layer1Data)) {
    const sheetLabel = result.sourceSheet || key
    rows.push({ label: sheetLabel, value: null, isStatementHeader: true })
    if (result.structured?.rows?.length) {
      flattenStructuredRows(result.structured.rows, 0, rows)
    } else {
      for (const [label, value] of Object.entries(result.lineItems)) {
        rows.push({ label, value: formatSourceValue(value) })
      }
    }
  }
  return rows
}

function buildL2Rows(
  sections: TemplateSection[],
  stmtLabel: string,
  layer2: Layer2Result,
): React.ComponentProps<typeof DataTable>['rows'] {
  const rows: React.ComponentProps<typeof DataTable>['rows'] = []
  rows.push({ label: stmtLabel, value: null, isStatementHeader: true })
  for (const section of sections) {
    if (section.header) rows.push({ label: section.header, value: null, isHeader: true })
    for (const field of section.fields) {
      const raw = layer2.formulaValues[field] ?? null
      rows.push({
        label: field,
        value: raw !== null ? formatFieldValue(field, raw) : null,
        isFlagged: layer2.flaggedFields.includes(field),
        isBold: BOLD_FIELDS.has(field),
        isIndented: isIndented(field),
        isItalic: ITALIC_FIELDS.has(field),
      })
    }
  }
  return rows
}

interface Props {
  layer1Data: Record<string, Layer1Result>
  layer2Data: Record<string, Layer2Result>
  companyName: string
  reportingPeriod: string
  onOverwrite: () => void
  onClose: () => void
}

export default function PreviousReviewPreview({
  layer1Data,
  layer2Data,
  companyName,
  reportingPeriod,
  onOverwrite,
  onClose,
}: Props) {
  const [template, setTemplate] = useState<TemplateResponse | null>(null)
  const [activeTab, setActiveTab] = useState<StmtKey>(() => {
    return STMT_KEYS.find(k => layer2Data[k]) ?? 'income_statement'
  })

  useEffect(() => {
    getTemplate().then(setTemplate).catch(() => {})
  }, [])

  const availableTabs = STMT_KEYS.filter(k => layer2Data[k])

  const l1Rows = buildL1Rows(layer1Data)

  const l2Rows = (() => {
    const layer2 = layer2Data[activeTab]
    if (!layer2) return []
    const stmtLabel = STMT_LABELS[activeTab]
    if (template) {
      const sections = template[activeTab]?.sections ?? []
      return buildL2Rows(sections, stmtLabel, layer2)
    }
    // Fallback: flat list of values
    const rows: React.ComponentProps<typeof DataTable>['rows'] = []
    rows.push({ label: stmtLabel, value: null, isStatementHeader: true })
    for (const [field, val] of Object.entries(layer2.formulaValues)) {
      rows.push({
        label: field,
        value: val !== null ? formatFieldValue(field, val) : null,
        isBold: BOLD_FIELDS.has(field),
        isIndented: isIndented(field),
        isItalic: ITALIC_FIELDS.has(field),
      })
    }
    return rows
  })()

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={15} />
            Back
          </button>
          <div className="w-px h-4 bg-border" />
          <div>
            <span className="text-[14px] font-semibold">{companyName}</span>
            <span className="text-[13px] text-muted-foreground ml-2">{reportingPeriod}</span>
          </div>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-medium">
            Previously Finalized
          </span>
        </div>
        <button
          onClick={onOverwrite}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] text-white transition-colors"
          style={{ backgroundColor: '#185FA5', fontWeight: 500 }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#134d8a')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#185FA5')}
        >
          <Upload size={14} />
          Upload New &amp; Overwrite
        </button>
      </div>

      {/* Statement tabs */}
      {availableTabs.length > 1 && (
        <div className="flex gap-1 px-6 pt-3 pb-0 shrink-0">
          {availableTabs.map(key => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-3 py-1.5 rounded-md text-[12px] transition-colors ${
                activeTab === key
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-gray-50'
              }`}
            >
              {STMT_LABELS[key]}
            </button>
          ))}
        </div>
      )}

      {/* Content: L1 left, L2 right */}
      <div className="flex flex-1 overflow-hidden min-h-0 mt-3">
        {/* L1 source panel */}
        <div className="flex flex-col w-[42%] border-r border-border overflow-hidden">
          <div className="px-4 py-2 shrink-0 border-b border-border bg-gray-50">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              Source Data (Layer 1)
            </span>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            <DataTable rows={l1Rows} />
          </div>
        </div>

        {/* L2 classified panel */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="px-4 py-2 shrink-0 border-b border-border bg-gray-50">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              Classified Values (Layer 2)
            </span>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            {l2Rows.length > 0
              ? <DataTable rows={l2Rows} />
              : <div className="flex items-center justify-center h-full text-[13px] text-muted-foreground">
                  No Layer 2 data for this statement.
                </div>
            }
          </div>
        </div>
      </div>
    </div>
  )
}
