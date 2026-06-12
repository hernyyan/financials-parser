/**
 * ColBadge — clickable column letter indicator.
 * Shows "(C)" in display mode; expands to an input in edit mode.
 * Input accepts uppercase letters only (non-letters are stripped).
 */

interface ColBadgeProps {
  colLetter: string
  field: string
  isEditing: boolean
  draft: string
  onEdit: () => void
  onDraftChange: (d: string) => void
  onConfirm: () => void
  onCancel: () => void
  disabled: boolean
}

export default function ColBadge({
  colLetter, field, isEditing, draft,
  onEdit, onDraftChange, onConfirm, onCancel, disabled,
}: ColBadgeProps) {
  if (isEditing) {
    return (
      <span className="flex items-center gap-0.5">
        <span className="text-slate-400">(col</span>
        <input
          autoFocus
          className="w-8 border border-blue-400 rounded px-1 text-[10px] font-mono text-blue-700 outline-none"
          value={draft}
          onChange={e => onDraftChange(e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase())}
          onKeyDown={e => { if (e.key === 'Enter') onConfirm(); if (e.key === 'Escape') onCancel() }}
        />
        <button
          onClick={onConfirm}
          disabled={disabled || !draft.trim()}
          className="text-blue-500 hover:text-blue-700 text-[10px] disabled:opacity-40"
        >↺</button>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 text-[10px]">✕</button>
        <span className="text-slate-400">)</span>
      </span>
    )
  }
  return (
    <button
      onClick={onEdit}
      disabled={disabled}
      className="text-slate-400 hover:text-blue-500 font-mono text-[10px] disabled:opacity-40"
      title={`Click to change ${field} column`}
    >
      ({colLetter})
    </button>
  )
}

/** Convert a column letter (e.g. "AN") to a 1-based column index. */
export function colLetterToIndex(letter: string): number {
  let index = 0
  const s = letter.toUpperCase().trim()
  for (let i = 0; i < s.length; i++) {
    index = index * 26 + (s.charCodeAt(i) - 64)
  }
  return index
}
