interface TabSelectorProps {
  tabs: string[]
  activeTab: string
  onChange: (tab: string) => void
  className?: string
}

export default function TabSelector({ tabs, activeTab, onChange, className = '' }: TabSelectorProps) {
  return (
    <div className={`flex border-b border-gray-200 bg-gray-50 flex-shrink-0 ${className}`}>
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
  )
}
