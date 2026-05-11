import { CompanyPeriodData } from './AdminApiClient'
import { BOLD_FIELDS, ITALIC_FIELDS, isIndented } from '../../utils/templateStyling'
import { useCompanyDataTable, DataView } from '../../hooks/useCompanyDataTable'

interface Props {
  periods: CompanyPeriodData[]
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
  const { view, setView, columns, labels, getCellValue, hasPeriod } = useCompanyDataTable({ periods })

  if (periods.length === 0) {
    return <p className="text-[12px] text-muted-foreground p-4">No finalized data for this company.</p>
  }

  if (columns.length === 0) {
    return <p className="text-[12px] text-muted-foreground p-4">No parseable period data.</p>
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-gray-50 shrink-0">
        {(['l2', 'l1'] as DataView[]).map((v) => (
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
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`text-right px-3 py-2 whitespace-nowrap font-mono min-w-[100px] ${hasPeriod(col.key) ? 'text-muted-foreground' : 'text-gray-300'}`}
                  style={{ fontWeight: 500 }}
                >
                  {col.shortLabel}
                </th>
              ))}
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
                  return (
                    <td
                      key={col.key}
                      className={`px-3 py-1.5 text-right font-mono ${
                        !hasPeriod(col.key) ? 'text-gray-200' :
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
