/**
 * TemplateTreePreview — read-only recursive renderer for Layer1TemplateRow[].
 *
 * Used in the Step 1 extraction preview to show the template tree exactly as
 * it appears in the template editor right panel, but without any interactive
 * controls (no operators, no drag handles, no eye/delete buttons).
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
}

function PreviewRow({ row, depth }: RowProps) {
  const isBold = row.type === 'sum' || row.operator === '='
  const indentPx = 8 + depth * 14

  return (
    <div>
      {/* Section break */}
      {(row as any).isSectionBreak ? (
        <div className="flex items-center mx-2 my-1">
          <div className="flex-1 border-t border-dashed border-slate-200" />
          <span className="mx-2 text-[9px] font-semibold text-slate-300 uppercase tracking-widest">Section</span>
          <div className="flex-1 border-t border-dashed border-slate-200" />
        </div>
      ) : (row as any).hidden ? null : (
        <div className="grid grid-cols-[56px_1fr_88px] items-center px-2 min-h-[26px] border-b border-slate-50">
          {/* Row number */}
          <span className="text-[10px] font-mono text-center" style={{ color: row.source_row ? '#94a3b8' : 'transparent' }}>
            {row.source_row || ''}
          </span>

          {/* Label */}
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

          {/* Value */}
          <span
            className={`text-[11px] font-mono text-right pr-1 ${
              row.value != null && row.value < 0 ? 'text-red-600' : 'text-slate-500'
            }`}
            style={{ fontWeight: isBold ? 600 : 400 }}
          >
            {fmt(row.value)}
          </span>
        </div>
      )}

      {/* Children */}
      {!((row as any).isSectionBreak) && row.children?.length > 0 && (
        row.children.map((child, i) => (
          <PreviewRow key={child.id ?? i} row={child} depth={depth + 1} />
        ))
      )}
    </div>
  )
}

interface Props {
  rows: Layer1TemplateRow[]
}

export default function TemplateTreePreview({ rows }: Props) {
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
        <PreviewRow key={row.id ?? i} row={row} depth={0} />
      ))}
    </div>
  )
}
