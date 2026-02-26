import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import LoadingSpinner from './LoadingSpinner'
import { API_BASE } from '../../api/client'

interface ExcelViewerProps {
  workbookUrl: string | null
  activeSheet: string
}

function formatCellValue(cell: XLSX.CellObject | undefined): string {
  if (!cell) return ''
  // Use Excel's pre-formatted text (respects number formats, accounting notation, etc.)
  if (cell.w !== undefined && cell.w !== null) return cell.w
  if (cell.v === null || cell.v === undefined) return ''
  return String(cell.v)
}

export default function ExcelViewer({ workbookUrl, activeSheet }: ExcelViewerProps) {
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workbookUrl) {
      setWorkbook(null)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    setWorkbook(null)

    fetch(`${API_BASE}${workbookUrl}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.arrayBuffer()
      })
      .then((buf) => {
        const wb = XLSX.read(buf, {
          type: 'array',
          cellStyles: true,
          cellDates: true,
          cellNF: true,
        })
        setWorkbook(wb)
      })
      .catch(() => {
        setError(
          'Unable to preview workbook. The file may be corrupted or in an unsupported format.',
        )
      })
      .finally(() => setLoading(false))
  }, [workbookUrl])

  const sheet = workbook?.Sheets[activeSheet] ?? null

  // Pre-compute merge and layout data so render is fast
  const tableData = useMemo(() => {
    if (!sheet || !sheet['!ref']) return null

    const range = XLSX.utils.decode_range(sheet['!ref'])
    const numRows = range.e.r - range.s.r + 1
    const numCols = range.e.c - range.s.c + 1

    // Merge map: "absRow,absCol" → {rowSpan, colSpan}
    const mergeMap = new Map<string, { rowSpan: number; colSpan: number }>()
    const skipped = new Set<string>()
    for (const m of (sheet['!merges'] as XLSX.Range[] | undefined) ?? []) {
      mergeMap.set(`${m.s.r},${m.s.c}`, {
        rowSpan: m.e.r - m.s.r + 1,
        colSpan: m.e.c - m.s.c + 1,
      })
      for (let r = m.s.r; r <= m.e.r; r++) {
        for (let c = m.s.c; c <= m.e.c; c++) {
          if (r === m.s.r && c === m.s.c) continue
          skipped.add(`${r},${c}`)
        }
      }
    }

    const colInfos = (sheet['!cols'] as XLSX.ColInfo[] | undefined) ?? []
    const rowInfos = (sheet['!rows'] as XLSX.RowInfo[] | undefined) ?? []
    const freeze = (sheet['!freeze'] as { r?: number; c?: number } | undefined) ?? {}
    const frozenRows = freeze.r ?? 0

    return { range, numRows, numCols, mergeMap, skipped, colInfos, rowInfos, frozenRows }
  }, [sheet])

  // ── Loading / error / empty states ─────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner message="Loading workbook preview..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center px-6 text-center">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    )
  }

  if (!workbookUrl || !workbook) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        No file uploaded yet
      </div>
    )
  }

  if (!sheet || !tableData) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        Sheet is empty or unavailable.
      </div>
    )
  }

  const { range, numRows, numCols, mergeMap, skipped, colInfos, rowInfos, frozenRows } = tableData

  // ── Table rendering ─────────────────────────────────────────────────────────

  function renderRow(r: number, isHeader: boolean): React.ReactElement {
    const absRow = r + range.s.r
    const rowHpt = rowInfos[absRow]?.hpt

    const cells: React.ReactElement[] = []
    for (let c = 0; c < numCols; c++) {
      const absCol = c + range.s.c
      const cellKey = `${absRow},${absCol}`
      if (skipped.has(cellKey)) continue

      const cellAddr = XLSX.utils.encode_cell({ r: absRow, c: absCol })
      const cell: XLSX.CellObject | undefined = sheet[cellAddr]
      const text = formatCellValue(cell)
      const isNum = cell?.t === 'n'

      let isBold = false
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        isBold = !!((cell?.s as any)?.font?.bold)
      } catch {
        /* style info not available in community edition */
      }

      const merge = mergeMap.get(cellKey)
      const colWch = colInfos[absCol]?.wch

      cells.push(
        <td
          key={c}
          rowSpan={merge?.rowSpan}
          colSpan={merge?.colSpan}
          style={{
            height: rowHpt ? `${rowHpt * 1.25}px` : undefined,
            minWidth: colWch ? `${Math.max(colWch * 7, 40)}px` : '48px',
            textAlign: isNum ? 'right' : 'left',
            fontWeight: isBold ? 'bold' : undefined,
          }}
          className={`px-2 border-r border-b border-gray-200 overflow-hidden whitespace-nowrap ${
            isHeader ? 'bg-gray-100' : ''
          } ${text === '' ? 'text-transparent select-none' : ''}`}
        >
          {text || '\u00A0'}
        </td>,
      )
    }

    return (
      <tr key={r} className={isHeader ? '' : 'hover:bg-blue-50/30'}>
        {cells}
      </tr>
    )
  }

  const headerRows = Array.from({ length: frozenRows }, (_, i) => renderRow(i, true))
  const bodyRows = Array.from({ length: numRows - frozenRows }, (_, i) =>
    renderRow(i + frozenRows, false),
  )

  return (
    <div
      className="flex-1 overflow-auto"
      style={{ fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace", fontSize: '12px' }}
    >
      <table
        className="border-collapse border-l border-t border-gray-200"
        style={{ tableLayout: 'auto', borderSpacing: 0 }}
      >
        {frozenRows > 0 && (
          <thead className="sticky top-0 z-10 bg-gray-100 shadow-sm">
            {headerRows}
          </thead>
        )}
        <tbody>{bodyRows}</tbody>
      </table>
    </div>
  )
}
