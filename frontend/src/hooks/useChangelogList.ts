import { useEffect, useState } from 'react'
import { adminGetChangelog } from '../api/client'

export function useChangelogList() {
  const [entries, setEntries] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [expandedCell, setExpandedCell] = useState<{ column: string; value: string } | null>(null)

  useEffect(() => {
    setLoading(true)
    adminGetChangelog({ limit: 200 })
      .then((data) => {
        setEntries(data.entries)
        setTotal(data.total_entries)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const columns = entries.length > 0 ? Object.keys(entries[0]) : []

  return { entries, total, loading, columns, expandedCell, setExpandedCell }
}
