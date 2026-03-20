import { PiggyBank } from 'lucide-react'

export default function AdminHeader() {
  return (
    <div
      className="flex items-center gap-3 px-5 py-3 shrink-0"
      style={{ backgroundColor: '#030213' }}
    >
      <PiggyBank className="w-5 h-5 text-amber-400" />
      <span className="text-white text-[15px]" style={{ fontWeight: 600 }}>
        Henry Admin
      </span>
    </div>
  )
}
