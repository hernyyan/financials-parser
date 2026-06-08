import { useRef } from 'react'
import { type Operator } from './templateRowTypes'
import { OP_OPTIONS, opDisplay } from './templateRowHelpers'

interface OpPopoverProps {
  current: Operator
  anchorRect: DOMRect
  onSelect: (op: Operator) => void
  onClose: () => void
}

export default function OpPopover({ current, anchorRect, onSelect, onClose }: OpPopoverProps) {
  return (
    <div
      className="fixed z-50 bg-white border border-slate-200 rounded-lg shadow-xl p-1.5 flex flex-col gap-0.5 min-w-[152px]"
      style={{ top: anchorRect.bottom + 4, left: anchorRect.left }}
      onMouseLeave={onClose}
    >
      {OP_OPTIONS.map(({ op, label, cls }) => (
        <button
          key={String(op)}
          onClick={() => onSelect(op)}
          className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs hover:bg-slate-50 text-left w-full ${
            current === op ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600'
          }`}
        >
          <span className={`inline-flex items-center justify-center w-7 h-5 rounded-full text-xs font-bold ${cls}`}>
            {opDisplay(op)}
          </span>
          {label}
        </button>
      ))}
    </div>
  )
}
