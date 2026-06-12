/**
 * TemplateTreePreview — read-only recursive renderer for Layer1TemplateRow[].
 *
 * Used in the Step 1 extraction preview and Step 2 left panel.
 * Shows row numbers, bold/italic/indent from tree structure. No operators or controls.
 *
 * Columns: row number | label | value
 */
import type { Layer1TemplateRow } from '../../types'

function fmt(value: number | null | undefined): string {
  if (value == null) return '—'
  if (value === 0) return '—'
  const abs = Math.abs(value)
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return value < 0 ? `(${s})` : s
}

interface RowProps {
  row: Layer1TemplateRow
  depth: number
  highlightedRows?: Set<number>
  onRowHover?: (sourceRow: number | null) => void
}

function PreviewRow({ row, depth, highlightedRows, onRowHover }: RowProps) {
  if ((row as any).isSectionBreak) {
    return (
      <div className="flex items-center mx-2 my-1">
        <div className="flex-1 border-t border-dashed border-slate-200" />
        <span className="mx-2 text-[9px] font-semibold text-slate-300 uppercase tracking-widest">Section</span>
        <div className="flex-1 border-t border-dashed border-slate-200" />
      </div>
    )
  }
  if ((row as any).hidden) return null

  const isBold = row.type === 'sum' || row.operator === '='
  const indentPx = 8 + depth * 14
  const srcRow = row.source_row ?? 0
  const isHighlighted = srcRow > 0 && highlightedRows?.has(srcRow)

  return (
    <div>
      <div
        className={`grid grid-cols-[56px_1fr_88px] items-center px-2 min-h-[26px] border-b border-slate-50 transition-colors ${isHighlighted ? 'bg-yellow-100' : ''}`}
        onMouseEnter={() => srcRow > 0 && onRowHover?.(srcRow)}
        onMouseLeave={() => onRowHover?.(null)}
      >
        <span className="text-[10px] font-mono text-center" style={{ color: srcRow > 0 ? '#94a3b8' : 'transparent' }}>
          {srcRow > 0 ? srcRow : ''}
        </span>
        <span
          className={`text-xs truncate ${!row.label ? 'invisible' : isBold ? 'text-slate-800' : 'text-slate-600'}`}
          style={{
            paddingLeft: indentPx,
            fontWeight: isBold || row.bold ? 600 : 400,
            fontStyle: row.italic ? 'italic' : 'normal',
          }}
        >
          {row.label || ' '}
        </span>
        <span
          className={`text-[11px] font-mono text-right pr-1 ${row.value != null && row.value < 0 ? 'text-red-600' : 'text-slate-500'}`}
          style={{ fontWeight: isBold ? 600 : 400 }}
        >
          {fmt(row.value)}
        </span>
      </div>

      {row.children?.length > 0 && row.children.map((child, i) => (
        <PreviewRow
          key={child.id ?? i}
          row={child}
          depth={depth + 1}
          highlightedRows={highlightedRows}
          onRowHover={onRowHover}
        />
      ))}
    </div>
  )
}

interface Props {
  rows: Layer1TemplateRow[]
  highlightedRows?: Set<number>
  onRowHover?: (sourceRow: number | null) => void
}

export default function TemplateTreePreview({ rows, highlightedRows, onRowHover }: Props) {
  if (!rows || rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-[12px] text-slate-400 italic">
        No rows extracted
      </div>
    )
  }

  return (
    <div>
      {rows.map((row, i) => (
        <PreviewRow
          key={row.id ?? i}
          row={row}
          depth={0}
          highlightedRows={highlightedRows}
          onRowHover={onRowHover}
        />
      ))}
    </div>
  )
}
