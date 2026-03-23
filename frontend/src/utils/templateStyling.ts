export const BOLD_FIELDS = new Set([
  'Gross Profit',
  'Total Operating Expenses',
  'EBITDA - Standard',
  'Adjusted EBITDA - Standard',
  'Net Income (Loss)',
  'Total Current Assets',
  'Total Non-Current Assets',
  'Total Assets',
  'Total Current Liabilities',
  'Total Non-Current Liabilities',
  'Total Liabilities',
  'Total Equity',
  'Total Liabilities and Equity',
])

export const SECTION_HEADERS = new Set([
  'ASSETS',
  'LIABILITIES',
  'EQUITY',
  'LTM - Adj EBITDA items',
])

export const STATEMENT_HEADERS = new Set(['Income Statement', 'Balance Sheet'])

export const ITALIC_FIELDS = new Set(['Check'])

/** Fields that are indented (not bold, not a section/statement header) */
export function isIndented(field: string): boolean {
  return (
    !BOLD_FIELDS.has(field) &&
    !SECTION_HEADERS.has(field) &&
    !STATEMENT_HEADERS.has(field)
  )
}
