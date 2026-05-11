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
  isPending?: boolean
  isBold?: boolean
  isIndented?: boolean
  isItalic?: boolean
}

interface DataTableProps {
  rows: DataTableRow[]
  onCellClick?: (label: string) => void
  selectedCell?: string | null
  className?: string
  scrollRef?: React.RefObject<HTMLDivElement>
  noScroll?: boolean
  /** 'blue' = SM tech tag bg (classified template), 'gray' = canvas bg (source data) */
  stmtHeaderStyle?: 'blue' | 'gray'
  /** Source rows to highlight with soft purple (mapped from selected template field) */
  highlightedLabels?: Set<string>
}

export default function DataTable({
  rows,
  onCellClick,
  selectedCell,
  className = '',
  scrollRef,
  noScroll = false,
  stmtHeaderStyle = 'blue',
  highlightedLabels,
}: DataTableProps) {
  return (
    <div ref={scrollRef} className={noScroll ? className : `overflow-auto flex-1 ${className}`}>
      <table className="w-full text-[12px] border-collapse">
        <tbody>
          {rows.map((row, idx) => {
            if (row.isStatementHeader) {
              // Both source and template statement headers use SM tech blue
              return (
                <tr key={idx} className="border-b border-[#e2e8f0]" style={{ backgroundColor: '#dbeafe' }}>
                  <td
                    colSpan={2}
                    className="px-4 py-2 text-[10px] uppercase"
                    style={{ fontWeight: 600, letterSpacing: '1.5px', color: '#1e40af' }}
                  >
                    {row.label}
                  </td>
                </tr>
              )
            }

            if (row.isHeader) {
              return (
                <tr key={idx} className="border-b border-[#e2e8f0]" style={{ backgroundColor: '#f8fafc' }}>
                  <td
                    colSpan={2}
                    className="px-4 py-1.5 text-[#64748b] text-[10px] uppercase"
                    style={{ fontWeight: 600, letterSpacing: '0.08em' }}
                  >
                    {row.label}
                  </td>
                </tr>
              )
            }

            const isSelected = selectedCell === row.label
            const isHighlighted = !isSelected && highlightedLabels?.has(row.label)

            // SM tag palette mapping:
            // selected    → ai-purple   (#ede9fe / #5b21b6)  — active edit target
            // highlighted → soft purple (#f5f3ff / #c4b5fd)  — mapped source rows
            // pending     → talent      (#fef3c7 / #92400e)  — live edit in progress
            // flagged     → talent      (#fef3c7 / #92400e)
            // fail        → finance     (#fee2e2 / #991b1b)
            // edited      → ai-purple   (#ede9fe / #5b21b6)
            let rowBg = ''
            let borderLeft = 'border-l-2 border-l-transparent'
            let hoverBg = 'hover:bg-[#f8fafc]'

            if (isSelected) {
              rowBg = 'bg-[#ede9fe]'
              borderLeft = 'border-l-2 border-l-[#5b21b6]'
              hoverBg = ''
            } else if (isHighlighted) {
              rowBg = 'bg-[#f5f3ff]'
              borderLeft = 'border-l-2 border-l-[#c4b5fd]'
              hoverBg = 'hover:bg-[#ede9fe]/50'
            } else if (row.isPending) {
              rowBg = 'bg-[#fef3c7]/60'
              borderLeft = 'border-l-2 border-l-[#92400e]'
              hoverBg = 'hover:bg-[#fef3c7]/80'
            } else if (row.isFlagged) {
              rowBg = 'bg-[#fef3c7]/40'
              borderLeft = 'border-l-2 border-l-[#92400e]'
              hoverBg = 'hover:bg-[#fef3c7]/70'
            } else if (row.hasValidationFail) {
              rowBg = 'bg-[#fee2e2]/40'
              borderLeft = 'border-l-2 border-l-[#991b1b]'
              hoverBg = 'hover:bg-[#fee2e2]/70'
            } else if (row.isEdited) {
              rowBg = 'bg-[#ede9fe]/40'
              borderLeft = 'border-l-2 border-l-[#5b21b6]'
              hoverBg = 'hover:bg-[#ede9fe]/70'
            }

            const rowClass = `${rowBg} ${borderLeft} ${hoverBg}`

            return (
              <tr
                key={idx}
                className={`border-b border-[#f1f5f9] transition-colors ${rowClass} ${
                  row.isClickable ? 'cursor-pointer' : ''
                }`}
                onClick={() => row.isClickable && onCellClick && onCellClick(row.label)}
              >
                <td className="py-1 px-4 w-[60%]">
                  <span className="flex items-center gap-1.5">
                    {row.isFlagged && (
                      <Flag className="w-3 h-3 shrink-0" style={{ color: '#92400e' }} />
                    )}
                    {row.hasValidationFail && !row.isFlagged && (
                      <AlertTriangle className="w-3 h-3 shrink-0" style={{ color: '#991b1b' }} />
                    )}
                    {row.isEdited && (
                      <Edit3 className="w-3 h-3 shrink-0" style={{ color: '#5b21b6' }} />
                    )}
                    <span
                      className={`truncate${row.isItalic ? ' italic' : ''}`}
                      style={{
                        fontWeight: row.isBold ? 600 : 400,
                        paddingLeft: row.isIndented ? '0.75rem' : undefined,
                        color: '#1a1f35',
                      }}
                    >
                      {row.label}
                    </span>
                  </span>
                </td>
                <td className="py-1 px-4 text-right w-[40%]">
                  <span
                    className="font-mono"
                    style={{
                      fontWeight: row.isPending || row.isEdited ? 500 : 400,
                      color: row.value === null || row.value === undefined
                        ? '#e2e8f0'
                        : row.isPending
                        ? '#92400e'
                        : row.isEdited
                        ? '#5b21b6'
                        : '#1a1f35',
                    }}
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
