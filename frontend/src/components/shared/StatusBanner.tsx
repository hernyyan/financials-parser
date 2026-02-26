interface StatusBannerProps {
  type: 'success' | 'error' | 'info' | 'warning'
  message: string
  onDismiss?: () => void
}

const styles = {
  success: 'bg-green-50 border-green-200 text-green-800',
  error: 'bg-red-50 border-red-200 text-red-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
}

const icons = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
  warning: '⚠',
}

export default function StatusBanner({ type, message, onDismiss }: StatusBannerProps) {
  return (
    <div className={`flex items-center gap-2 px-4 py-2.5 border rounded text-sm ${styles[type]}`}>
      <span className="font-medium">{icons[type]}</span>
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="ml-2 hover:opacity-70 transition-opacity font-medium"
          aria-label="Dismiss"
        >
          ✕
        </button>
      )}
    </div>
  )
}
