const STATUS_CLASSES: Record<string, string> = {
  finalized: 'bg-emerald-50 text-emerald-700',
  step2_complete: 'bg-blue-50 text-blue-700',
}

const DEFAULT_CLASS = 'bg-gray-100 text-gray-600'

export default function ReviewStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[10px] ${STATUS_CLASSES[status] ?? DEFAULT_CLASS}`}
      style={{ fontWeight: 500 }}
    >
      {status}
    </span>
  )
}
