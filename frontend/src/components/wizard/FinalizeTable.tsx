import { AlertTriangle, CheckCircle2, Edit3, Flag, XCircle } from 'lucide-react'
import { formatDollar } from '../../utils/formatters'
import type { FinalizeRow } from '../../utils/finalizeRows'

interface FinalizeTableProps {
  rows: FinalizeRow[]
  isBalanced: boolean
  balanceDiff: number
}

export default function FinalizeTable({ rows, isBalanced, balanceDiff }: FinalizeTableProps) {
  return (
    <div className="bg-white border border-border rounded-lg overflow-hidden">
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-border sticky top-0 z-10">
            <th className="px-4 py-2 w-8" />
            <th className="px-4 py-2 text-left text-muted-foreground" style={{ fontWeight: 500 }}>
              Field
            </th>
            <th className="px-4 py-2 text-right text-muted-foreground" style={{ fontWeight: 500 }}>
              Classified Value
            </th>
            <th className="px-4 py-2 text-right text-muted-foreground" style={{ fontWeight: 500 }}>
              Final Value
            </th>
            <th className="px-4 py-2 text-left text-muted-foreground w-[120px]" style={{ fontWeight: 500 }}>
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            if (row.isStatementHeader) {
              return (
                <tr key={idx} className="bg-blue-50/50 border-b border-border">
                  <td
                    colSpan={5}
                    className="px-4 py-2 text-blue-700 text-[11px] uppercase"
                    style={{ fontWeight: 600, letterSpacing: '0.05em' }}
                  >
                    {row.label}
                  </td>
                </tr>
              )
            }

            if (row.isHeader) {
              return (
                <tr key={idx} className="bg-gray-50/80 border-b border-gray-200">
                  <td
                    colSpan={5}
                    className="px-4 py-1.5 text-muted-foreground text-[10px] uppercase"
                    style={{ fontWeight: 600, letterSpacing: '0.08em' }}
                  >
                    {row.label}
                  </td>
                </tr>
              )
            }

            if (row.isBalanceCheck) {
              return (
                <tr key={idx} className="bg-gray-50 border-b border-gray-200">
                  <td className="px-4 py-1.5">
                    {isBalanced ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <XCircle className="w-3 h-3 text-red-500" />
                    )}
                  </td>
                  <td className="px-4 py-1.5 text-muted-foreground" style={{ fontWeight: 500 }}>
                    Balance Check
                  </td>
                  <td
                    colSpan={3}
                    className={`px-4 py-1.5 ${isBalanced ? 'text-emerald-600' : 'text-red-600'}`}
                    style={{ fontWeight: 500 }}
                  >
                    {isBalanced
                      ? 'Balanced'
                      : `Imbalanced — difference: ${formatDollar(balanceDiff)}`}
                  </td>
                </tr>
              )
            }

            const rowBg = row.corrected
              ? 'bg-purple-50/30'
              : row.flagged
              ? 'bg-amber-50/30'
              : row.validationFail
              ? 'bg-red-50/30'
              : ''

            const isNegFinal =
              row.rawFinalValue !== null &&
              row.rawFinalValue !== undefined &&
              row.rawFinalValue < 0

            return (
              <tr key={idx} className={`border-b border-gray-100 ${rowBg}`}>
                <td className="px-4 py-1.5">
                  {row.flagged && <Flag className="w-3 h-3 text-amber-500" />}
                  {row.validationFail && <AlertTriangle className="w-3 h-3 text-red-500" />}
                  {row.corrected && <Edit3 className="w-3 h-3 text-purple-500" />}
                </td>
                <td
                  className={`py-1.5${row.isItalic ? ' italic' : ''}`}
                  style={{
                    fontWeight: row.isBold ? 600 : 400,
                    paddingLeft: row.isIndented ? '1.75rem' : '1rem',
                  }}
                >
                  {row.label}
                </td>
                <td
                  className={`px-4 py-1.5 text-right font-mono ${
                    row.classifiedValue === null ? 'text-gray-300' : ''
                  } ${row.corrected ? 'line-through text-muted-foreground' : ''}`}
                >
                  {row.classifiedValue ?? '—'}
                </td>
                <td
                  className={`px-4 py-1.5 text-right font-mono ${
                    row.finalValue === null ? 'text-gray-300' : ''
                  } ${row.corrected ? 'text-purple-700' : ''} ${
                    isNegFinal && !row.corrected ? 'text-red-600' : ''
                  }`}
                  style={{ fontWeight: row.corrected ? 500 : 400 }}
                >
                  {row.finalValue ?? '—'}
                </td>
                <td className="px-4 py-1.5">
                  {row.corrected && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700" style={{ fontWeight: 500 }}>
                      Corrected
                    </span>
                  )}
                  {row.flagged && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700" style={{ fontWeight: 500 }}>
                      Flagged
                    </span>
                  )}
                  {row.validationFail && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700" style={{ fontWeight: 500 }}>
                      Validation Fail
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
