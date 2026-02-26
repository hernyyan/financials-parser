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
}

export default function DataTable({
  rows,
  onCellClick,
  selectedCell,
  className = '',
  scrollRef,
}: DataTableProps) {
  return (
    <div ref={scrollRef} className={`overflow-auto flex-1 ${className}`}>
      <table className="w-full text-xs financial-table border-collapse">
        <tbody>
          {rows.map((row, idx) => {
            if (row.isStatementHeader) {
              return (
                <tr key={idx} className="bg-gray-700 border-y border-gray-600">
                  <td
                    colSpan={2}
                    className="px-3 py-2 font-bold text-white text-[11px] uppercase tracking-wider"
                  >
                    {row.label}
                  </td>
                </tr>
              )
            }

            if (row.isHeader) {
              return (
                <tr key={idx} className="bg-gray-100 border-y border-gray-200">
                  <td
                    colSpan={2}
                    className="px-3 py-1.5 font-semibold text-gray-600 uppercase tracking-wide text-[10px]"
                  >
                    {row.label}
                  </td>
                </tr>
              )
            }

            const isSelected = selectedCell === row.label
            const rowBg = row.isFlagged
              ? 'bg-amber-50'
              : isSelected
              ? 'bg-blue-50'
              : idx % 2 === 0
              ? 'bg-white'
              : 'bg-gray-50/50'

            return (
              <tr
                key={idx}
                className={`border-b border-gray-100 hover:bg-blue-50/50 transition-colors ${rowBg} ${
                  row.isClickable ? 'cursor-pointer' : ''
                }`}
                onClick={() => row.isClickable && onCellClick && onCellClick(row.label)}
              >
                <td className="px-3 py-1.5 text-gray-700 w-[60%]">
                  <span className={row.isFlagged ? 'text-amber-700' : ''}>{row.label}</span>
                  {row.isFlagged && (
                    <span className="ml-1.5 text-[9px] bg-amber-200 text-amber-700 px-1 py-0.5 rounded uppercase font-semibold">
                      flagged
                    </span>
                  )}
                  {row.isEdited && (
                    <span className="ml-1.5 text-[9px] bg-blue-100 text-blue-600 px-1 py-0.5 rounded uppercase font-semibold">
                      edited
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right w-[40%]">
                  <span className="flex items-center justify-end gap-1.5">
                    {row.hasValidationFail && (
                      <button
                        className="text-red-500 hover:text-red-700 transition-colors text-sm leading-none"
                        title="Validation failure — click to view details"
                        onClick={(e) => {
                          e.stopPropagation()
                          onCellClick && onCellClick(row.label)
                        }}
                      >
                        ⚠️
                      </button>
                    )}
                    <span
                      className={`font-tabular tabular-nums ${
                        row.value === null || row.value === undefined
                          ? 'text-gray-300'
                          : row.isEdited
                          ? 'text-blue-600 font-medium'
                          : typeof row.value === 'string' && row.value.startsWith('(')
                          ? 'text-red-600'
                          : typeof row.value === 'number' && row.value < 0
                          ? 'text-red-600'
                          : 'text-gray-900'
                      }`}
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
