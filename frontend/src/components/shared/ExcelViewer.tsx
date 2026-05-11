import { useEffect, useMemo, useState } from 'react'
import ExcelJS from 'exceljs'
import LoadingSpinner from './LoadingSpinner'
import { API_BASE } from '../../api/client'

interface ExcelViewerProps {
  workbookUrl: string | null
  activeSheet: string
}

function formatCellValue(cell: ExcelJS.Cell): string {
  if (!cell || cell.type === ExcelJS.ValueType.Null) return ''
  return cell.text ?? String(cell.value ?? '')
}

export default function ExcelViewer({ workbookUrl, activeSheet }: ExcelViewerProps) {
  const [workbook, setWorkbook] = useState<ExcelJS.Workbook | null>(null)
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
      .then(async (buf) => {
        const wb = new ExcelJS.Workbook()
        await wb.xlsx.load(buf)
        setWorkbook(wb)
      })
      .catch(() => {
        setError(
          'Unable to preview workbook. The file may be corrupted or in an unsupported format.',
        )
      })
      .finally(() => setLoading(false))
  }, [workbookUrl])

  const sheet = workbook?.getWorksheet(activeSheet) ?? null

  // Pre-compute merge and layout data so render is fast
  const tableData = useMemo(() => {
    if (!sheet) return null

    const dims = sheet.dimensions as { top: number; left: number; bottom: number; right: number } | null | undefined
    if (!dims || typeof dims.top !== 'number') return null

    const { top, left, bottom, right } = dims
    const numRows = bottom - top + 1
    const numCols = right - left + 1

    const MAX_RENDER_ROWS = 300
    const MAX_RENDER_COLS = 40
    const renderRows = Math.min(numRows, MAX_RENDER_ROWS)
    const renderCols = Math.min(numCols, MAX_RENDER_COLS)

    // Merge map: "absRow,absCol" (0-indexed) → {rowSpan, colSpan}
    const mergeMap = new Map<string, { rowSpan: number; colSpan: number }>()
    const skipped = new Set<string>()
    const mergesRaw = (sheet as unknown as { model?: { merges?: string[] } }).model?.merges ?? []
    for (const mergeStr of mergesRaw) {
      const [startRef, endRef] = mergeStr.split(':')
      if (!startRef || !endRef) continue
      const startCell = sheet.getCell(startRef)
      const endCell = sheet.getCell(endRef)
      const r1 = Number(startCell.row) - 1
      const c1 = Number(startCell.col) - 1
      const r2 = Number(endCell.row) - 1
      const c2 = Number(endCell.col) - 1
      mergeMap.set(`${r1},${c1}`, { rowSpan: r2 - r1 + 1, colSpan: c2 - c1 + 1 })
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          if (r === r1 && c === c1) continue
          skipped.add(`${r},${c}`)
        }
      }
    }

    // Frozen rows from sheet views
    const views = sheet.views as ExcelJS.WorksheetView[]
    const frozenRows = views.find((v) => v.state === 'frozen')?.ySplit ?? 0

    return { top, left, numRows, numCols, renderRows, renderCols, mergeMap, skipped, frozenRows }
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

  const { top, left, numRows, numCols, renderRows, renderCols, mergeMap, skipped, frozenRows } = tableData

  const isTruncated = numRows > renderRows || numCols > renderCols

  // ── Table rendering ─────────────────────────────────────────────────────────

  function renderRow(r: number, isHeader: boolean): React.ReactElement {
    const absRow = r + top   // 1-indexed ExcelJS row
    const rowObj = sheet!.getRow(absRow)
    const rowHpt = rowObj.height

    const cells: React.ReactElement[] = []
    for (let c = 0; c < renderCols; c++) {
      const absCol = c + left  // 1-indexed ExcelJS col
      const cellKey = `${absRow - 1},${absCol - 1}`  // 0-indexed for maps
      if (skipped.has(cellKey)) continue

      const cell = sheet!.getCell(absRow, absCol)
      const text = formatCellValue(cell)
      const isNum = cell.type === ExcelJS.ValueType.Number
      const isBold = (cell.font as ExcelJS.Font | undefined)?.bold ?? false

      const merge = mergeMap.get(cellKey)
      const colObj = sheet!.getColumn(absCol)
      const colWch = colObj.width

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

  const headerRows = Array.from({ length: Math.min(frozenRows, renderRows) }, (_, i) =>
    renderRow(i, true),
  )
  const bodyRows = Array.from({ length: renderRows - frozenRows }, (_, i) =>
    renderRow(i + frozenRows, false),
  )

  return (
    <div
      className="flex-1 overflow-auto"
      style={{ fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace", fontSize: '12px' }}
    >
      {isTruncated && (
        <div className="px-3 py-1 bg-blue-50 border-b border-blue-200 text-[11px] text-blue-600 sticky top-0 z-20">
          Preview showing {renderRows} of {numRows} rows, {renderCols} of {numCols} columns. Full data is used for extraction.
        </div>
      )}
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
