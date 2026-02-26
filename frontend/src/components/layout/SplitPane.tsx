interface SplitPaneProps {
  left: React.ReactNode
  right: React.ReactNode
  leftWidth?: string   // tailwind width class, e.g. 'w-1/2'
  rightWidth?: string
  className?: string
}

export default function SplitPane({
  left,
  right,
  leftWidth = 'w-1/2',
  rightWidth = 'w-1/2',
  className = '',
}: SplitPaneProps) {
  return (
    <div className={`flex flex-1 overflow-hidden divide-x divide-gray-200 ${className}`}>
      <div className={`${leftWidth} flex flex-col overflow-hidden`}>{left}</div>
      <div className={`${rightWidth} flex flex-col overflow-hidden`}>{right}</div>
    </div>
  )
}
