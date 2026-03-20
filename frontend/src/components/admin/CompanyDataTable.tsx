import { useState } from 'react'
import { CompanyPeriodData } from './AdminApiClient'

interface Props {
  periods: CompanyPeriodData[]
}

type View = 'l1' | 'l2'

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

  if (periods.length === 0) {
    return <p className="text-[12px] text-muted-foreground p-4">No review data found for this company.</p>
  }

  // Collect all row labels across all periods
  const allLabels = new Set<string>()
  for (const p of periods) {
    const data = view === 'l1' ? p.layer1_data : p.layer2_data
    if (!data) continue
    // L2 data is nested under statement sections; L1 is flat lineItems
    if (view === 'l1') {
      const lineItems = (data as Record<string, unknown>).lineItems
      if (lineItems && typeof lineItems === 'object') {
        Object.keys(lineItems as object).forEach((k) => allLabels.add(k))
      }
    } else {
      // L2 values: flat key→value under each statement type
      const is = (data as Record<string, unknown>).income_statement
      const bs = (data as Record<string, unknown>).balance_sheet
      if (is && typeof is === 'object') {
        const vals = (is as Record<string, unknown>).values
        if (vals && typeof vals === 'object') Object.keys(vals as object).forEach((k) => allLabels.add(k))
      }
      if (bs && typeof bs === 'object') {
        const vals = (bs as Record<string, unknown>).values
        if (vals && typeof vals === 'object') Object.keys(vals as object).forEach((k) => allLabels.add(k))
      }
    }
  }
  const labels = Array.from(allLabels)

  function getCellValue(period: CompanyPeriodData, label: string): unknown {
    const data = view === 'l1' ? period.layer1_data : period.layer2_data
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
              {periods.map((p) => (
                <th key={p.session_id} className="text-right px-3 py-2 text-muted-foreground whitespace-nowrap font-mono min-w-[120px]" style={{ fontWeight: 500 }}>
                  {p.reporting_period || p.session_id.slice(0, 8)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((label, i) => (
              <tr key={label} className={i % 2 === 0 ? '' : 'bg-gray-50/50'}>
                <td className="px-3 py-1.5 border-r border-gray-100 text-foreground">{label}</td>
                {periods.map((p) => {
                  const val = getCellValue(p, label)
                  const display = formatVal(val)
                  return (
                    <td
                      key={p.session_id}
                      className={`px-3 py-1.5 text-right font-mono ${display === '—' ? 'text-muted-foreground' : typeof val === 'number' && val < 0 ? 'text-red-600' : ''}`}
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
