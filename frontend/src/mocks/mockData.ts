import type { Layer1Result, Layer2Result, UploadResponse } from '../types'

// Mock upload response
export const MOCK_UPLOAD_RESPONSE: UploadResponse = {
  sessionId: 'mock-session-001',
  sheetNames: ['Income Statement', 'Balance Sheet'],
  workbookUrl: '/files/mock-session-001/workbook.xlsx',
  fileType: 'excel',
}

// Mock Layer 1 output - Income Statement
export const MOCK_LAYER1_INCOME_STATEMENT: Layer1Result = {
  lineItems: {
    'Total Gross Sales': 3621577.27,
    'Less: Cost of Sales': 432658.88,
    'Gross Profit': 3188918.39,
    'Gross Margin': 0.8805,
    'Total Direct Labor': 2148600.78,
    'Total Indirect Labor': 307794.17,
    'Taxes and Benefits': 254742.61,
    'Direct Operating Expense': 75853.47,
    'Indirect Operating Expense': 745332.7,
    'Total Depreciation and Amortization': 99611.56,
    'Other Income & Expense': -86417.6,
    'Total Interest Expense / (Income)': 573676.04,
    'Total Income Tax': 12109.85,
    'Net Profit/Loss': -942385.19,
    'Reported EBITDA Before Extraordinary Expense': -256987.74,
    'EBITDA Margin': -0.071,
  },
  sourceScaling: 'actual_dollars',
  columnIdentified: '03/31/2024',
  sourceSheet: 'Income Statement',
}

// Mock Layer 1 output - Balance Sheet
export const MOCK_LAYER1_BALANCE_SHEET: Layer1Result = {
  lineItems: {
    'Cash and Cash Equivalents': 284531.12,
    'Accounts Receivable, Net': 1124879.45,
    'Inventory': 312450.0,
    'Prepaid Expenses and Other Current Assets': 87234.56,
    'Total Current Assets': 1809095.13,
    'Property, Plant & Equipment, Gross': 2341567.89,
    'Accumulated Depreciation': -876543.21,
    'Net PP&E': 1465024.68,
    'Goodwill': 4250000.0,
    'Other Intangible Assets': 875000.0,
    'Other Non-Current Assets': 125678.9,
    'Total Assets': 8524798.71,
    'Accounts Payable': 456789.12,
    'Accrued Liabilities': 312456.78,
    'Current Portion of Long-Term Debt': 125000.0,
    'Other Current Liabilities': 89234.56,
    'Total Current Liabilities': 983480.46,
    'Long-Term Debt, Net': 3750000.0,
    'Deferred Tax Liabilities': 234567.89,
    'Other Non-Current Liabilities': 156789.0,
    'Total Non-Current Liabilities': 4141356.89,
    'Total Liabilities': 5124837.35,
    'Common Stock': 100000.0,
    'Additional Paid-In Capital': 4250000.0,
    'Retained Earnings (Deficit)': -950038.64,
    'Total Equity': 3399961.36,
    'Total Liabilities and Equity': 8524798.71,
  },
  sourceScaling: 'actual_dollars',
  columnIdentified: '03/31/2024',
  sourceSheet: 'Balance Sheet',
}

// Mock Layer 2 output - Income Statement
export const MOCK_LAYER2_INCOME_STATEMENT: Layer2Result = {
  statementType: 'income_statement',
  formulaValues: {
    'Total Revenue': 3621577.27,
    'COGS': 432658.88,
    'Gross Profit': 3188918.39,
    'Total Operating Expenses': 3532323.73,
    'EBITDA - Standard': -343405.34,
    'EBITDA Adjustments': null,
    'Adjusted EBITDA - Standard': null,
    'Depreciation & Amortization': 99611.56,
    'Interest Expense/(Income)': 573676.04,
    'Other Expense / (Income)': -86417.6,
    'Taxes': 12109.85,
    'Net Income (Loss)': -942385.19,
    'LTM - Adj EBITDA items': null,
    'Equity Cure': null,
    'Adjusted EBITDA - Including Cures': null,
    'Covenant EBITDA': null,
  },
  pythonCheckValues: {
    'Gross Profit': 3188918.39,
    'EBITDA - Standard': -343405.34,
    'Net Income (Loss)': -942385.19,
  },
  pythonFlaggedFields: [],
  formulas: {
    'Total Revenue': [{ operator: '+', row: 1, label: 'Total Gross Sales' }],
    'COGS': [{ operator: '+', row: 2, label: 'Less: Cost of Sales' }],
    'Depreciation & Amortization': [{ operator: '+', row: 5, label: 'Total Depreciation and Amortization' }],
    'Net Income (Loss)': [{ operator: '+', row: 10, label: 'Net Profit/Loss' }],
  },
  sourceLabels: {
    'Total Revenue': ['Total Gross Sales'],
    'COGS': ['Less: Cost of Sales'],
  },
  flaggedFields: [],
}

// Mock Layer 2 output - Balance Sheet
export const MOCK_LAYER2_BALANCE_SHEET: Layer2Result = {
  statementType: 'balance_sheet',
  formulaValues: {
    'Cash & Cash Equivalents': 284531.12,
    'Accounts Receivable': 1124879.45,
    'Inventory': 312450.0,
    'Prepaid Expenses': 87234.56,
    'Other Current Assets': null,
    'Total Current Assets': 1809095.13,
    'Property, Plant & Equipment': 2341567.89,
    'Accumulated Depreciation': -876543.21,
    'Goodwill & Intangibles': 5125000.0,
    'Other non-current assets': 125678.9,
    'Total Non-Current Assets': 6715703.58,
    'Total Assets': 8524798.71,
    'Accounts Payable': 456789.12,
    'Accrued Liabilities': 312456.78,
    'Deferred Revenue': null,
    'Revolver - Balance Sheet': null,
    'Current Maturities': 125000.0,
    'Other Current Liabilities': 89234.56,
    'Total Current Liabilities': 983480.46,
    'Long Term Loans': 3750000.0,
    'Long Term Leases': null,
    'Other Non-Current Liabilities': 391356.89,
    'Total Non-Current Liabilities': 4141356.89,
    'Total Liabilities': 5124837.35,
    'Paid in Capital': 4250000.0,
    'Retained Earnings': -950038.64,
    'Other Equity': 100000.0,
    'Total Equity': 3399961.36,
    'Total Liabilities and Equity': 8524798.71,
    'Check': 0.0,
  },
  pythonCheckValues: {
    'Total Current Assets': 1809095.13,
    'Total Assets': 8524798.71,
    'Total Liabilities': 5124837.35,
    'Total Equity': 3399961.36,
    'Total Liabilities and Equity': 8524798.71,
    'Check': 0.0,
  },
  pythonFlaggedFields: [],
  formulas: {
    'Cash & Cash Equivalents': [{ operator: '+', row: 1, label: 'Cash and Cash Equivalents' }],
    'Accounts Receivable': [{ operator: '+', row: 2, label: 'Accounts Receivable, Net' }],
    'Total Assets': [{ operator: '+', row: 10, label: 'Total Assets' }],
  },
  sourceLabels: {
    'Cash & Cash Equivalents': ['Cash and Cash Equivalents'],
    'Accounts Receivable': ['Accounts Receivable, Net'],
    'Total Assets': ['Total Assets'],
  },
  flaggedFields: [],
}

// Income Statement template fields in order (matching loader_template.csv)
export const IS_TEMPLATE_FIELDS = [
  'Gross Revenue',
  'Net Revenue',
  'Total Revenue',
  'COGS',
  'COGS - Depreciation & Amortization',
  'Gross Profit',
  'Gross Profit Margin %',
  'Sales & Marketing Expenses',
  'Administrative Expenses',
  'Compensation & Benefits Expense',
  'Research & Development',
  'Rent Expense',
  'Management Fee Expense',
  'Other Operating Expenses',
  'Total Operating Expenses',
  'Net Operating Income',
  'Depreciation & Amortization',
  'Loss/(Gain) on Assets, Debt, FX',
  'Non-Operating Expenses',
  'Non-Operating Expenses - Depreciation & Amortization',
  'Interest Expense/(Income)',
  'Other Income',
  'Other Expenses',
  'Total Expense/(Income)',
  'Income (Loss) Before Taxes',
  'Taxes',
  'Net Income (Loss)',
  'EBIT',
  'EBITDA',
  'EBITDA Adjustments',
  'Adjusted EBITDA',
  'Covenant EBITDA',
  'EBITDA Margin %',
  'Adjusted EBITDA Margin %',
  'Covenant EBITDA Margin %',
]

// Balance Sheet template fields in order
export const BS_TEMPLATE_FIELDS = [
  'Cash & Cash Equivalents',
  'Short Term Investments',
  'Accounts Receivable',
  'Inventory',
  'Prepaid Expenses',
  'Other Current Assets',
  'Total Current Assets',
  'Property, Plant & Equipment',
  'Accumulated Depreciation',
  'Total Fixed Assets',
  'Other Non-Current Assets',
  'Goodwill & Intangibles',
  'Total Non-Current Assets',
  'Total Assets',
  'Accounts Payable',
  'Short Term Loans',
  'Short Term Capitalized Leases',
  'Short Term Mortgages',
  'Short Term Debt',
  'Accrued Liabilities',
  'Other Current Liabilities',
  'Total Current Liabilities',
  'Long Term Loans',
  'Long Term Capitalized Leases',
  'Long Term Mortgages',
  'Long Term Debt',
  'Deferred Liabilities',
  'Other Non-Current Liabilities',
  'Total Non-Current Liabilities',
  'Total Liabilities',
  'Preferred Stock',
  'Common Stock',
  'Paid in Capital',
  'Other Comprehensive Income',
  'Retained Earnings',
  'Minority Interest',
  'Total Equity',
  'Total Liabilities and Equity',
  'Check',
]

// Helper: format a financial number
export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (Math.abs(value) >= 1000000) {
    return `$${(value / 1000000).toFixed(2)}M`
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${value.toFixed(2)}%`
}

export function formatValue(fieldName: string, value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (fieldName.includes('%') || fieldName.includes('Margin')) {
    return formatPercent(value)
  }
  return formatCurrency(value)
}
