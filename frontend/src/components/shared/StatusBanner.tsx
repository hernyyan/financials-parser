import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react'

interface StatusBannerProps {
  type: 'success' | 'error' | 'info' | 'warning'
  message: string
  onDismiss?: () => void
}

const styles = {
  success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  error: 'bg-red-50 border-red-200 text-red-700',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
}

const icons = {
  success: <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />,
  error: <XCircle className="w-4 h-4 text-red-500 shrink-0" />,
  info: <Info className="w-4 h-4 text-blue-500 shrink-0" />,
  warning: <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />,
}

export default function StatusBanner({ type, message, onDismiss }: StatusBannerProps) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2.5 border rounded-lg text-[13px] ${styles[type]}`}>
      {icons[type]}
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="ml-1 hover:opacity-70 transition-opacity"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}
