import { Flag, AlertTriangle, Edit3 } from 'lucide-react'

interface DataTableRow {
  label: string
  value: string | number | null
  isHeader?: boolean
  isStatementHeader?: boolean
  isFlagged?: boolean
  hasValidationFail?: boolean
  isClickable?: boolean
  isEdited?: boolean
}

interface DataTableProps {
  rows: DataTableRow[]
  onCellClick?: (label: string) => void
  selectedCell?: string | null
  className?: string
  scrollRef?: React.RefObject<HTMLDivElement>
  noScroll?: boolean
  /** 'blue' = blue-50 bg (classified template), 'gray' = gray-100 bg (source data) */
  stmtHeaderStyle?: 'blue' | 'gray'
}

export default function DataTable({
  rows,
  onCellClick,
  selectedCell,
  className = '',
  scrollRef,
  noScroll = false,
  stmtHeaderStyle = 'blue',
}: DataTableProps) {
  return (
    <div ref={scrollRef} className={noScroll ? className : `overflow-auto flex-1 ${className}`}>
      <table className="w-full text-[12px] border-collapse">
        <tbody>
          {rows.map((row, idx) => {
            if (row.isStatementHeader) {
              if (stmtHeaderStyle === 'gray') {
                return (
                  <tr key={idx} className="bg-gray-100/60 border-b border-border">
                    <td
                      colSpan={2}
                      className="px-4 py-2 text-muted-foreground text-[11px] uppercase"
                      style={{ fontWeight: 600, letterSpacing: '0.05em' }}
                    >
                      {row.label}
                    </td>
                  </tr>
                )
              }
              return (
                <tr key={idx} className="bg-blue-50/50 border-b border-border">
                  <td
                    colSpan={2}
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
                <tr key={idx} className="bg-gray-50 border-b border-gray-200">
                  <td
                    colSpan={2}
                    className="px-4 py-1.5 text-muted-foreground text-[10px] uppercase"
                    style={{ fontWeight: 600, letterSpacing: '0.08em' }}
                  >
                    {row.label}
                  </td>
                </tr>
              )
            }

            const isSelected = selectedCell === row.label

            // Row state priority: selected > flagged > validationFail > edited > normal
            let rowClass = 'border-l-2 border-l-transparent hover:bg-gray-50'
            if (isSelected) {
              rowClass = 'bg-blue-50 border-l-2 border-l-blue-500'
            } else if (row.isFlagged) {
              rowClass = 'bg-amber-50/40 border-l-2 border-l-amber-400 hover:bg-amber-50'
            } else if (row.hasValidationFail) {
              rowClass = 'bg-red-50/40 border-l-2 border-l-red-400 hover:bg-red-50'
            } else if (row.isEdited) {
              rowClass = 'bg-purple-50/40 border-l-2 border-l-purple-400 hover:bg-purple-50'
            }

            const isNegative =
              (typeof row.value === 'string' && row.value.startsWith('(')) ||
              (typeof row.value === 'number' && row.value < 0)

            return (
              <tr
                key={idx}
                className={`border-b border-gray-100 transition-colors ${rowClass} ${
                  row.isClickable ? 'cursor-pointer' : ''
                }`}
                onClick={() => row.isClickable && onCellClick && onCellClick(row.label)}
              >
                <td className="py-1 px-4 w-[60%]">
                  <span className="flex items-center gap-1.5">
                    {row.isFlagged && (
                      <Flag className="w-3 h-3 text-amber-500 shrink-0" />
                    )}
                    {row.hasValidationFail && !row.isFlagged && (
                      <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />
                    )}
                    {row.isEdited && (
                      <Edit3 className="w-3 h-3 text-purple-500 shrink-0" />
                    )}
                    <span
                      className="truncate"
                      style={{
                        fontWeight:
                          typeof row.label === 'string' &&
                          (row.label.includes('Total') ||
                            row.label.includes('Gross') ||
                            row.label.includes('Net') ||
                            row.label === 'EBITDA')
                            ? 500
                            : 400,
                      }}
                    >
                      {row.label}
                    </span>
                  </span>
                </td>
                <td className="py-1 px-4 text-right w-[40%]">
                  <span
                    className={`font-mono ${
                      row.value === null || row.value === undefined
                        ? 'text-gray-300'
                        : row.isEdited
                        ? 'text-purple-700'
                        : isNegative
                        ? 'text-red-600'
                        : ''
                    }`}
                    style={{ fontWeight: row.isEdited ? 500 : 400 }}
                  >
                    {row.value === null || row.value === undefined
                      ? '—'
                      : typeof row.value === 'string'
                      ? row.value
                      : row.value.toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
