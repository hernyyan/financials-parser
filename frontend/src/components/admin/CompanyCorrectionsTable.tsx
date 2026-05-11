import type { StatementType } from '../../types'
import { STATEMENT_ABBREVS } from '../../utils/statementMeta'
import { AdminCorrection } from './AdminApiClient'

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

interface Props {
  corrections: AdminCorrection[]
}

export default function CompanyCorrectionsTable({ corrections }: Props) {
  if (corrections.length === 0) {
    return <p className="text-[12px] text-muted-foreground p-4">No corrections for this company.</p>
  }

  return (
    <table className="text-[12px] border-collapse w-full">
      <thead>
        <tr className="bg-gray-50 border-b border-border sticky top-0">
          <th className="text-left px-3 py-2 text-muted-foreground" style={{ fontWeight: 500 }}>Period</th>
          <th className="text-left px-3 py-2 text-muted-foreground" style={{ fontWeight: 500 }}>Statement</th>
          <th className="text-left px-3 py-2 text-muted-foreground" style={{ fontWeight: 500 }}>Field</th>
          <th className="text-right px-3 py-2 text-muted-foreground font-mono" style={{ fontWeight: 500 }}>L2 Value</th>
          <th className="text-right px-3 py-2 text-muted-foreground font-mono" style={{ fontWeight: 500 }}>Corrected</th>
          <th className="text-left px-3 py-2 text-muted-foreground" style={{ fontWeight: 500 }}>Reasoning</th>
          <th className="text-center px-3 py-2 text-muted-foreground" style={{ fontWeight: 500 }}>Status</th>
        </tr>
      </thead>
      <tbody>
        {corrections.map((c, i) => (
          <tr key={c.id} className={i % 2 === 0 ? '' : 'bg-gray-50/50'}>
            <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{c.period || '—'}</td>
            <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
              {STATEMENT_ABBREVS[c.statement_type as StatementType] ?? c.statement_type}
            </td>
            <td className="px-3 py-1.5">{c.field_name}</td>
            <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{formatVal(c.layer2_value)}</td>
            <td className={`px-3 py-1.5 text-right font-mono ${c.corrected_value < 0 ? 'text-red-600' : ''}`}>
              {formatVal(c.corrected_value)}
            </td>
            <td className="px-3 py-1.5 text-muted-foreground max-w-[300px] truncate">{c.analyst_reasoning || '—'}</td>
            <td className="px-3 py-1.5 text-center">
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] ${c.processed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
                style={{ fontWeight: 500 }}
              >
                {c.processed ? 'processed' : 'pending'}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
