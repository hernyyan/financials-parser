import { useEffect, useRef, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'

interface TabSelectorProps {
  tabs: string[]
  activeTab: string
  onChange: (tab: string) => void
  extractedTabs?: string[]
  smallText?: boolean
  className?: string
}

export default function TabSelector({
  tabs,
  activeTab,
  onChange,
  extractedTabs = [],
  smallText = false,
  className = '',
}: TabSelectorProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  function updateArrows() {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    updateArrows()
    el.addEventListener('scroll', updateArrows, { passive: true })
    const observer = new ResizeObserver(updateArrows)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', updateArrows)
      observer.disconnect()
    }
  }, [tabs])

  function scrollTabs(amount: number) {
    scrollRef.current?.scrollBy({ left: amount, behavior: 'smooth' })
  }

  const showArrows = canScrollLeft || canScrollRight
  const extractedSet = new Set(extractedTabs)

  return (
    <div className={`flex border-b border-border bg-gray-50 flex-shrink-0 ${className}`}>
      {showArrows && (
        <button
          onClick={() => scrollTabs(-150)}
          disabled={!canScrollLeft}
          className="flex-shrink-0 px-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30 bg-gray-50 border-r border-border"
          aria-label="Scroll tabs left"
        >
          ‹
        </button>
      )}
      <div ref={scrollRef} className="flex flex-1 min-w-0 overflow-hidden">
        {tabs.map((tab) => {
          const isActive = activeTab === tab
          const isExtracted = extractedSet.has(tab)
          return (
            <button
              key={tab}
              onClick={() => onChange(tab)}
              className={`px-4 py-1.5 border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                smallText ? 'text-[11px]' : 'text-[12px]'
              } ${
                isActive
                  ? 'border-primary text-primary bg-white'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-gray-100'
              }`}
              style={{ fontWeight: isActive ? 500 : 400 }}
            >
              {tab}
              {isExtracted && (
                <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
              )}
            </button>
          )
        })}
      </div>
      {showArrows && (
        <button
          onClick={() => scrollTabs(150)}
          disabled={!canScrollRight}
          className="flex-shrink-0 px-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30 bg-gray-50 border-l border-border"
          aria-label="Scroll tabs right"
        >
          ›
        </button>
      )}
    </div>
  )
}
