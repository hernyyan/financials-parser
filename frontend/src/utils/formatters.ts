/**
 * Shared financial number formatting utilities.
 * Use these in all template tables (Step 2 center, Step 3 output, SidePanel).
 * Do NOT use for raw Layer 1 source data (those are extracted without margin detection).
 */

export function formatDollar(value: number): string {
  if (value === 0) return '$0.00'
  const abs = Math.abs(value)
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return value < 0 ? `($${formatted})` : `$${formatted}`
}

export function formatPercent(value: number): string {
  if (value === 0) return '0.00%'
  return `${value.toFixed(2)}%`
}

export function formatValue(fieldName: string, value: number): string {
  if (fieldName.endsWith('%') || fieldName.toLowerCase().includes('margin')) {
    return formatPercent(value)
  }
  return formatDollar(value)
}

/** Handles null/undefined — returns '—' for missing values. */
export function formatFieldValue(fieldName: string, value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return formatValue(fieldName, value)
}
