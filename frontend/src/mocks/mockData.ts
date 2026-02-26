import type { Layer1Result, Layer2Result, UploadResponse } from '../types'

// Mock upload response
export const MOCK_UPLOAD_RESPONSE: UploadResponse = {
  sessionId: 'mock-session-001',
  sheetNames: ['Income Statement', 'Balance Sheet'],
  pdfUrls: {
    'Income Statement': '/files/mock-session-001/income_statement.pdf',
    'Balance Sheet': '/files/mock-session-001/balance_sheet.pdf',
  },
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
}

// Mock Layer 2 output - Income Statement
export const MOCK_LAYER2_INCOME_STATEMENT: Layer2Result = {
  statementType: 'income_statement',
  values: {
    'Gross Revenue': null,
    'Net Revenue': 3621577.27,
    'Total Revenue': 3621577.27,
    'COGS': 432658.88,
    'COGS - Depreciation & Amortization': null,
    'Gross Profit': 3188918.39,
    'Gross Profit Margin %': 88.05,
    'Sales & Marketing Expenses': null,
    'Administrative Expenses': null,
    'Compensation & Benefits Expense': 2711137.56,
    'Research & Development': null,
    'Rent Expense': null,
    'Management Fee Expense': null,
    'Other Operating Expenses': 821186.17,
    'Total Operating Expenses': 3532323.73,
    'Net Operating Income': -343405.34,
    'Depreciation & Amortization': 99611.56,
    'Loss/(Gain) on Assets, Debt, FX': null,
    'Non-Operating Expenses': null,
    'Non-Operating Expenses - Depreciation & Amortization': null,
    'Interest Expense/(Income)': 573676.04,
    'Other Income': 86417.6,
    'Other Expenses': null,
    'Total Expense/(Income)': 586870.0,
    'Income (Loss) Before Taxes': -930275.34,
    'Taxes': 12109.85,
    'Net Income (Loss)': -942385.19,
    'EBIT': -356599.3,
    'EBITDA - Standard': -256987.74,
    'EBITDA Adjustments': null,
    'Adjusted EBITDA - Standard': null,
    'EBITDA - Reported': -256987.74,
    'Adjusted EBITDA - Reported': null,
    'Covenant EBITDA': null,
    'EBITDA - Standard Margin %': -7.1,
    'Adjusted EBITDA - Standard Margin %': null,
    'Adjusted EBITDA - Reported Margin %': null,
    'Covenant EBITDA Margin %': null,
  },
  reasoning: {
    'Net Revenue':
      "Source 'Total Gross Sales' ($3,621,577.27) mapped directly. Only single revenue line reported, so treated as Net Revenue.",
    'COGS': "Source 'Less: Cost of Sales' ($432,658.88) mapped directly as Cost of Goods Sold.",
    'Gross Profit':
      "Verified via two methods: (1) Source 'Gross Profit' ($3,188,918.39); (2) Calculated: $3,621,577.27 - $432,658.88 = $3,188,918.39. Both agree.",
    'Compensation & Benefits Expense':
      'Aggregation: Total Direct Labor ($2,148,600.78) + Total Indirect Labor ($307,794.17) + Taxes and Benefits ($254,742.61) = $2,711,137.56.',
    'Other Operating Expenses':
      'Aggregation: Direct Operating Expense ($75,853.47) + Indirect Operating Expense ($745,332.70) = $821,186.17. These did not clearly fit other OpEx categories.',
    'Net Income (Loss)':
      "Verified: (1) Source 'Net Profit/Loss' (-$942,385.19); (2) Calculated: -$930,275.34 - $12,109.85 = -$942,385.19. Both agree.",
    'EBITDA - Standard':
      "Source 'Reported EBITDA Before Extraordinary Expense' (-$256,987.74) used. Consistent with EBIT (-$356,599.30) + D&A ($99,611.56) = -$256,987.74.",
    'Interest Expense/(Income)':
      "Source 'Total Interest Expense / (Income)' ($573,676.04) mapped directly.",
    'Other Income':
      "Source 'Other Income & Expense' shows a credit balance of -$86,417.60, which represents income. Mapped to Other Income as positive $86,417.60.",
    'Depreciation & Amortization':
      "Source 'Total Depreciation and Amortization' ($99,611.56) mapped directly.",
  },
  validation: {
    'Check 1 - Total Revenue = Net Revenue': {
      checkName: 'Check 1 - Total Revenue = Net Revenue',
      status: 'PASS',
      details: '$3,621,577.27 = $3,621,577.27',
    },
    'Check 2 - Gross Profit = Total Revenue - COGS - COGS D&A': {
      checkName: 'Check 2 - Gross Profit = Total Revenue - COGS - COGS D&A',
      status: 'PASS',
      details: '$3,188,918.39 = $3,621,577.27 - $432,658.88 - $0',
    },
    'Check 5 - Net Operating Income = Gross Profit - Total OpEx': {
      checkName: 'Check 5 - Net Operating Income = Gross Profit - Total OpEx',
      status: 'FAIL',
      details:
        'Expected: $3,188,918.39 - $3,532,323.73 = -$343,405.34. Got: -$343,405.34. Discrepancy in OpEx components — verify aggregation.',
    },
    'Check 8 - Net Income = IBT - Taxes': {
      checkName: 'Check 8 - Net Income = IBT - Taxes',
      status: 'PASS',
      details: '-$942,385.19 = -$930,275.34 - $12,109.85',
    },
  },
  flaggedFields: [],
  fieldValidations: {
    'Total Revenue': ['Check 1 - Total Revenue = Net Revenue'],
    'Net Revenue': ['Check 1 - Total Revenue = Net Revenue'],
    'Gross Profit': ['Check 2 - Gross Profit = Total Revenue - COGS - COGS D&A'],
    'Net Operating Income': ['Check 5 - Net Operating Income = Gross Profit - Total OpEx'],
    'Net Income (Loss)': ['Check 8 - Net Income = IBT - Taxes'],
  },
}

// Mock Layer 2 output - Balance Sheet
export const MOCK_LAYER2_BALANCE_SHEET: Layer2Result = {
  statementType: 'balance_sheet',
  values: {
    'Cash & Cash Equivalents': 284531.12,
    'Short Term Investments': null,
    'Accounts Receivable': 1124879.45,
    'Inventory': 312450.0,
    'Prepaid Expenses': 87234.56,
    'Other Current Assets': null,
    'Total Current Assets': 1809095.13,
    'Property, Plant & Equipment': 2341567.89,
    'Accumulated Depreciation': -876543.21,
    'Total Fixed Assets': 1465024.68,
    'Other Non-Current Assets': 125678.9,
    'Goodwill & Intangibles': 5125000.0,
    'Total Non-Current Assets': 6715703.58,
    'Total Assets': 8524798.71,
    'Accounts Payable': 456789.12,
    'Short Term Loans': null,
    'Short Term Capitalized Leases': null,
    'Short Term Mortgages': null,
    'Short Term Debt': 125000.0,
    'Accrued Liabilities': 312456.78,
    'Other Current Liabilities': 89234.56,
    'Total Current Liabilities': 983480.46,
    'Long Term Loans': 3750000.0,
    'Long Term Capitalized Leases': null,
    'Long Term Mortgages': null,
    'Long Term Debt': 3750000.0,
    'Deferred Liabilities': 234567.89,
    'Other Non-Current Liabilities': 156789.0,
    'Total Non-Current Liabilities': 4141356.89,
    'Total Liabilities': 5124837.35,
    'Preferred Stock': null,
    'Common Stock': 100000.0,
    'Paid in Capital': 4250000.0,
    'Other Comprehensive Income': null,
    'Retained Earnings': -950038.64,
    'Minority Interest': null,
    'Total Equity': 3399961.36,
    'Total Liabilities and Equity': 8524798.71,
    'Check': 0.0,
  },
  reasoning: {
    'Cash & Cash Equivalents':
      "Source 'Cash and Cash Equivalents' ($284,531.12) mapped directly.",
    'Accounts Receivable':
      "Source 'Accounts Receivable, Net' ($1,124,879.45) mapped directly. Net of allowances.",
    'Goodwill & Intangibles':
      "Aggregation: Goodwill ($4,250,000.00) + Other Intangible Assets ($875,000.00) = $5,125,000.00.",
    'Total Assets':
      "Source 'Total Assets' ($8,524,798.71) verified against sum of current + non-current assets.",
    'Total Equity':
      "Aggregation: Common Stock ($100,000) + Additional Paid-In Capital ($4,250,000) + Retained Earnings (-$950,038.64) = $3,399,961.36.",
    'Check':
      'Balance check: Total Assets ($8,524,798.71) - Total Liabilities and Equity ($8,524,798.71) = $0.00. Balance sheet balances.',
  },
  validation: {
    'Check BS-1 - Total Assets = Total Liabilities + Total Equity': {
      checkName: 'Check BS-1 - Total Assets = Total Liabilities + Total Equity',
      status: 'PASS',
      details: '$8,524,798.71 = $5,124,837.35 + $3,399,961.36',
    },
    'Check BS-2 - Total Current Assets components': {
      checkName: 'Check BS-2 - Total Current Assets components',
      status: 'PASS',
      details: '$1,809,095.13 = $284,531.12 + $1,124,879.45 + $312,450.00 + $87,234.56',
    },
    'Check BS-3 - Total Equity components': {
      checkName: 'Check BS-3 - Total Equity components',
      status: 'FAIL',
      details:
        'Expected: $100,000 + $4,250,000 + (-$950,038.64) = $3,399,961.36. Source shows $3,399,961.36. Minor rounding discrepancy detected.',
    },
  },
  flaggedFields: [],
  fieldValidations: {
    'Total Assets': ['Check BS-1 - Total Assets = Total Liabilities + Total Equity'],
    'Total Liabilities': ['Check BS-1 - Total Assets = Total Liabilities + Total Equity'],
    'Total Equity': [
      'Check BS-1 - Total Assets = Total Liabilities + Total Equity',
      'Check BS-3 - Total Equity components',
    ],
    'Total Current Assets': ['Check BS-2 - Total Current Assets components'],
  },
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
  'EBITDA - Standard',
  'EBITDA Adjustments',
  'Adjusted EBITDA - Standard',
  'EBITDA - Reported',
  'Adjusted EBITDA - Reported',
  'Covenant EBITDA',
  'EBITDA - Standard Margin %',
  'Adjusted EBITDA - Standard Margin %',
  'Adjusted EBITDA - Reported Margin %',
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
