/**
 * useSplitPane — resizable two-panel layout hook.
 *
 * Manages left-panel percentage width and global mouse event listeners
 * for drag-to-resize. Caller attaches containerRef to the split container
 * div and handleDividerMouseDown to the divider element.
 *
 * Returns:
 *   leftPct              — current left panel width as percentage
 *   containerRef         — attach to the outer split container div
 *   handleDividerMouseDown — attach to the divider element's onMouseDown
 */
import { useRef, useState } from 'react'

interface UseSplitPaneOptions {
  defaultPct?: number
  minLeftPx?: number
  minRightPx?: number
}

export function useSplitPane({
  defaultPct = 65,
  minLeftPx = 300,
  minRightPx = 320,
}: UseSplitPaneOptions = {}) {
  const [leftPct, setLeftPct] = useState(defaultPct)
  const containerRef = useRef<HTMLDivElement>(null)

  function handleDividerMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()

    function onMouseMove(ev: MouseEvent) {
      const pct = ((ev.clientX - rect.left) / rect.width) * 100
      const min = (minLeftPx / rect.width) * 100
      const max = ((rect.width - minRightPx) / rect.width) * 100
      setLeftPct(Math.min(Math.max(pct, min), max))
    }

    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  return { leftPct, containerRef, handleDividerMouseDown }
}
