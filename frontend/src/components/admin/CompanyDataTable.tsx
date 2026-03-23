import { useState } from 'react'
import { CompanyPeriodData } from './AdminApiClient'
import { getTemplate } from '../../api/client'
import { useEffect } from 'react'
import { BOLD_FIELDS, ITALIC_FIELDS, isIndented } from '../../utils/templateStyling'
import type { TemplateResponse } from '../../types'

interface Props {
  periods: CompanyPeriodData[]
}

type View = 'l1' | 'l2'

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTH_SHORT  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function parseReportingPeriod(period: string): { year: number; month: number; key: string } | null {
  const months: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  }
  const parts = period.trim().split(/\s+/)
  if (parts.length !== 2) return null
  const month = months[parts[0].toLowerCase()]
  const year = parseInt(parts[1])
  if (!month || isNaN(year)) return null
  return { year, month, key: `${year}-${String(month).padStart(2, '0')}` }
}

function generateMonthRange(
  start: { year: number; month: number },
  end: { year: number; month: number },
): { year: number; month: number; key: string; label: string; shortLabel: string }[] {
  const result = []
  let y = start.year, m = start.month
  while (y < end.year || (y === end.year && m <= end.month)) {
    result.push({
      year: y, month: m,
      key: `${y}-${String(m).padStart(2, '0')}`,
      label: `${MONTH_NAMES[m - 1]} ${y}`,
      shortLabel: `${MONTH_SHORT[m - 1]} ${y}`,
    })
    m++
    if (m > 12) { m = 1; y++ }
  }
  return result
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') {
    if (v === 0) return '0'
    const abs = Math.abs(v)
    const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return v < 0 ? `(${formatted})` : formatted
  }
  return String(v)
}

export default function CompanyDataTable({ periods }: Props) {
  const [view, setView] = useState<View>('l2')
  const [template, setTemplate] = useState<TemplateResponse | null>(null)

  useEffect(() => {
    getTemplate().then(setTemplate).catch(console.error)
  }, [])

  if (periods.length === 0) {
    return <p className="text-[12px] text-muted-foreground p-4">No finalized data for this company.</p>
  }

  // Build a map from period key → period data
  const periodByKey = new Map<string, CompanyPeriodData>()
  let minParsed: { year: number; month: number } | null = null
  let maxParsed: { year: number; month: number } | null = null

  for (const p of periods) {
    const parsed = parseReportingPeriod(p.reporting_period)
    if (!parsed) continue
    periodByKey.set(parsed.key, p)
    if (!minParsed || parsed.key < `${minParsed.year}-${String(minParsed.month).padStart(2, '0')}`) minParsed = parsed
    if (!maxParsed || parsed.key > `${maxParsed.year}-${String(maxParsed.month).padStart(2, '0')}`) maxParsed = parsed
  }

  if (!minParsed || !maxParsed) {
    return <p className="text-[12px] text-muted-foreground p-4">No parseable period data.</p>
  }

  const columns = generateMonthRange(minParsed, maxParsed)

  // Collect row labels
  let labels: string[] = []
  if (view === 'l2' && template) {
    // Use template field order for L2
    for (const stmt of ['income_statement', 'balance_sheet'] as const) {
      for (const section of template[stmt]?.sections ?? []) {
        for (const field of section.fields) {
          if (!labels.includes(field)) labels.push(field)
        }
      }
    }
  } else {
    // L1: collect all unique lineItem keys across all periods
    const allKeys = new Set<string>()
    for (const p of periods) {
      const data = p.layer1_data
      if (!data) continue
      const lineItems = (data as Record<string, unknown>).lineItems
      if (lineItems && typeof lineItems === 'object') {
        Object.keys(lineItems as object).forEach((k) => allKeys.add(k))
      }
    }
    labels = Array.from(allKeys)
  }

  function getCellValue(colKey: string, label: string): unknown {
    const p = periodByKey.get(colKey)
    if (!p) return null
    const data = view === 'l1' ? p.layer1_data : p.layer2_data
    if (!data) return null
    if (view === 'l1') {
      const lineItems = (data as Record<string, unknown>).lineItems as Record<string, unknown> | undefined
      return lineItems?.[label] ?? null
    }
    const is = (data as Record<string, unknown>).income_statement as Record<string, unknown> | undefined
    const bs = (data as Record<string, unknown>).balance_sheet as Record<string, unknown> | undefined
    const isVals = is?.values as Record<string, unknown> | undefined
    const bsVals = bs?.values as Record<string, unknown> | undefined
    return isVals?.[label] ?? bsVals?.[label] ?? null
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-gray-50 shrink-0">
        {(['l2', 'l1'] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1 rounded text-[12px] transition-colors ${
              view === v ? 'text-foreground bg-white border border-border shadow-sm' : 'text-muted-foreground hover:bg-gray-100'
            }`}
            style={{ fontWeight: view === v ? 500 : 400 }}
          >
            {v === 'l1' ? 'Layer 1 (raw)' : 'Layer 2 (classified)'}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto">
        <table className="text-[12px] border-collapse w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-border sticky top-0">
              <th className="text-left px-3 py-2 text-muted-foreground min-w-[220px]" style={{ fontWeight: 500 }}>Field</th>
              {columns.map((col) => {
                const hasData = periodByKey.has(col.key)
                return (
                  <th
                    key={col.key}
                    className={`text-right px-3 py-2 whitespace-nowrap font-mono min-w-[100px] ${hasData ? 'text-muted-foreground' : 'text-gray-300'}`}
                    style={{ fontWeight: 500 }}
                  >
                    {col.shortLabel}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {labels.map((label, i) => (
              <tr key={label} className={i % 2 === 0 ? '' : 'bg-gray-50/50'}>
                <td
                  className={`py-1.5 border-r border-gray-100 text-foreground${view === 'l2' && ITALIC_FIELDS.has(label) ? ' italic' : ''}`}
                  style={{
                    fontWeight: view === 'l2' && BOLD_FIELDS.has(label) ? 600 : 400,
                    paddingLeft: view === 'l2' && isIndented(label) ? '1.25rem' : '0.75rem',
                    paddingRight: '0.75rem',
                  }}
                >{label}</td>
                {columns.map((col) => {
                  const val = getCellValue(col.key, label)
                  const display = formatVal(val)
                  const isGap = !periodByKey.has(col.key)
                  return (
                    <td
                      key={col.key}
                      className={`px-3 py-1.5 text-right font-mono ${
                        isGap ? 'text-gray-200' :
                        display === '—' ? 'text-muted-foreground' :
                        typeof val === 'number' && val < 0 ? 'text-red-600' : ''
                      }`}
                    >
                      {display}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
