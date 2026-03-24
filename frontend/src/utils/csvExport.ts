export function exportToCsv(data: Record<string, unknown>[], filename: string) {
  if (data.length === 0) return
  const columns = Object.keys(data[0])
  const header = columns.join(',')
  const rows = data.map((row) =>
    columns.map((col) => {
      const val = row[col]
      const str = val === null || val === undefined ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val)
      return `"${str.replace(/"/g, '""')}"`
    }).join(',')
  )
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
