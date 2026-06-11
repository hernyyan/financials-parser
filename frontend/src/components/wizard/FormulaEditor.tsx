/**
 * FormulaEditor — inline structured formula editor for Layer 2 field mappings.
 *
 * Displays a vertical list of formula rows: [Op ▼] [Row #] [Label (read-only)]
 * The user can drag to reorder, add rows at the bottom, and delete rows.
 * Saves only when all rows have a valid row number and operator.
 *
 * Row number validation: on blur, the entered number is checked against
 * the L1 value map. If invalid, it is silently voided to null.
 */
import { useRef, useState } from 'react'
import { GripVertical, Plus, X } from 'lucide-react'
import type { L2Formula } from '../../types'

let _nextDraftId = 1
function nextDraftId() { return _nextDraftId++ }

interface DraftRow {
  id: number
  operator: '+' | '-'
  row: number | null
  label: string
}

interface Props {
  initialFormula: L2Formula
  l1ValueMap: Map<number, number | null>
  onSave: (formula: L2Formula) => void
  onCancel: () => void
}

export default function FormulaEditor({ initialFormula, l1ValueMap, onSave, onCancel }: Props) {
  const [rows, setRows] = useState<DraftRow[]>(() =>
    initialFormula.length > 0
      ? initialFormula.map(fr => ({ id: nextDraftId(), operator: fr.operator, row: fr.row, label: fr.label }))
      : [{ id: nextDraftId(), operator: '+', row: null, label: '' }]
  )

  const dragSrcIdx = useRef<number | null>(null)

  // ── Validation ──────────────────────────────────────────────────────────────

  const isValid = rows.length > 0 && rows.every(r => r.row !== null)

  function resolveLabel(rowNum: number): string {
    if (!l1ValueMap.has(rowNum)) return ''
    // Walk back to find label — encoded in the map key only if we have it
    // FormulaEditor receives the label from parent; here we just confirm validity
    return `Row ${rowNum}`
  }

  function handleRowBlur(id: number, rawValue: string) {
    const num = parseInt(rawValue, 10)
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r
      if (!rawValue || isNaN(num) || !l1ValueMap.has(num)) {
        return { ...r, row: null, label: '' }
      }
      return { ...r, row: num, label: r.label || resolveLabel(num) }
    }))
  }

  function handleRowInput(id: number, rawValue: string, existingLabels: Map<number, string>) {
    const num = parseInt(rawValue, 10)
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r
      if (!rawValue) return { ...r, row: null, label: '' }
      if (!isNaN(num) && l1ValueMap.has(num)) {
        return { ...r, row: num, label: existingLabels.get(num) ?? `Row ${num}` }
      }
      return { ...r, row: null, label: '' }
    }))
  }

  function setOperator(id: number, op: '+' | '-') {
    setRows(prev => prev.map(r => r.id === id ? { ...r, operator: op } : r))
  }

  function addRow() {
    setRows(prev => [...prev, { id: nextDraftId(), operator: '+', row: null, label: '' }])
  }

  function removeRow(id: number) {
    setRows(prev => prev.filter(r => r.id !== id))
  }

  // ── Drag to reorder ─────────────────────────────────────────────────────────

  function onDragStart(e: React.DragEvent, idx: number) {
    dragSrcIdx.current = idx
    e.dataTransfer.effectAllowed = 'move'
  }

  function onDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault()
    const src = dragSrcIdx.current
    if (src === null || src === idx) return
    setRows(prev => {
      const next = [...prev]
      const [moved] = next.splice(src, 1)
      next.splice(idx, 0, moved)
      dragSrcIdx.current = idx
      return next
    })
  }

  function onDragEnd() {
    dragSrcIdx.current = null
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  function handleSave() {
    if (!isValid) return
    const formula: L2Formula = rows
      .filter(r => r.row !== null)
      .map(r => ({ operator: r.operator, row: r.row!, label: r.label }))
    onSave(formula)
  }

  // ── Labels lookup — built from l1ValueMap keys + any existing labels ────────

  // We receive labels through the initial formula; for new rows we show "Row N"
  const knownLabels = new Map<number, string>(
    initialFormula.map(fr => [fr.row, fr.label])
  )

  return (
    <div className="flex flex-col gap-2">
      {/* Row list */}
      <div className="flex flex-col gap-1">
        {rows.map((r, idx) => (
          <div
            key={r.id}
            draggable
            onDragStart={e => onDragStart(e, idx)}
            onDragOver={e => onDragOver(e, idx)}
            onDragEnd={onDragEnd}
            className="flex items-center gap-1.5 px-1 py-1 rounded bg-slate-50 border border-slate-200 group"
          >
            {/* Drag handle */}
            <GripVertical className="w-3.5 h-3.5 text-slate-300 cursor-grab shrink-0" />

            {/* Operator toggle */}
            <select
              value={r.operator}
              onChange={e => setOperator(r.id, e.target.value as '+' | '-')}
              className="w-10 text-[12px] border border-slate-300 rounded px-1 py-0.5 bg-white shrink-0"
            >
              <option value="+">+</option>
              <option value="-">−</option>
            </select>

            {/* Row number input */}
            <input
              type="number"
              min={1}
              placeholder="Row #"
              defaultValue={r.row ?? ''}
              key={`row-${r.id}-${r.row}`}
              onBlur={e => handleRowBlur(r.id, e.target.value)}
              onChange={e => handleRowInput(r.id, e.target.value, knownLabels)}
              className={`w-16 text-[12px] border rounded px-1.5 py-0.5 shrink-0 ${
                r.row === null && '' !== '' ? 'border-red-300 bg-red-50' : 'border-slate-300'
              }`}
            />

            {/* Label (read-only) */}
            <span className="flex-1 text-[12px] text-slate-600 truncate min-w-0">
              {r.row !== null ? (r.label || `Row ${r.row}`) : (
                <span className="text-slate-400 italic">enter row number</span>
              )}
            </span>

            {/* Delete */}
            {rows.length > 1 && (
              <button
                onClick={() => removeRow(r.id)}
                className="opacity-0 group-hover:opacity-100 shrink-0 text-slate-400 hover:text-red-500 transition-opacity"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Add row */}
      <button
        onClick={addRow}
        className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 py-0.5 transition-colors"
      >
        <Plus className="w-3.5 h-3.5" /> Add row
      </button>

      {/* Save / Cancel */}
      <div className="flex items-center gap-2 pt-1 border-t border-slate-200">
        <button
          onClick={handleSave}
          disabled={!isValid}
          className="px-3 py-1 text-[12px] rounded bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          style={{ fontWeight: 500 }}
        >
          Save Formula
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1 text-[12px] rounded border border-slate-300 text-slate-600 hover:bg-slate-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
