import { useEffect, useRef, useState } from 'react'

interface TabSelectorProps {
  tabs: string[]
  activeTab: string
  onChange: (tab: string) => void
  className?: string
}

export default function TabSelector({ tabs, activeTab, onChange, className = '' }: TabSelectorProps) {
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

  return (
    <div className={`flex border-b border-gray-200 bg-gray-50 flex-shrink-0 ${className}`}>
      {showArrows && (
        <button
          onClick={() => scrollTabs(-150)}
          disabled={!canScrollLeft}
          className="flex-shrink-0 px-1.5 text-gray-400 hover:text-gray-600 disabled:opacity-30 bg-gray-50 border-r border-gray-200"
          aria-label="Scroll tabs left"
        >
          ‹
        </button>
      )}
      <div ref={scrollRef} className="flex flex-1 min-w-0 overflow-hidden">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => onChange(tab)}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab
                ? 'border-blue-600 text-blue-600 bg-white'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
      {showArrows && (
        <button
          onClick={() => scrollTabs(150)}
          disabled={!canScrollRight}
          className="flex-shrink-0 px-1.5 text-gray-400 hover:text-gray-600 disabled:opacity-30 bg-gray-50 border-l border-gray-200"
          aria-label="Scroll tabs right"
        >
          ›
        </button>
      )}
    </div>
  )
}
