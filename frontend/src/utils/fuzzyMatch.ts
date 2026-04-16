import type { StatementTabConfig } from '../api/client'

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function fuzzyMatchTab(savedTab: string, availableTabs: string[]): string | null {
  const normSaved = normalize(savedTab)
  let best: string | null = null
  let bestScore = 0
  for (const tab of availableTabs) {
    const normTab = normalize(tab)
    const maxLen = Math.max(normSaved.length, normTab.length)
    if (maxLen === 0) continue
    const dist = levenshtein(normSaved, normTab)
    const score = 1 - dist / maxLen
    if (score > bestScore) {
      bestScore = score
      best = tab
    }
  }
  return bestScore >= 0.6 ? best : null
}

/** Returns null if ANY saved tab cannot be fuzzy-matched — fail-safe, don't apply partial configs. */
export function applyStatementTabConfig(
  saved: StatementTabConfig,
  availableTabs: string[],
): { tabs: string[]; fieldAssignments: Record<string, string> } | null {
  const matched: string[] = []
  const tabMap: Record<string, string> = {}
  for (const savedTab of saved.tabs) {
    const match = fuzzyMatchTab(savedTab, availableTabs)
    if (!match) return null
    matched.push(match)
    tabMap[savedTab] = match
  }
  const fieldAssignments: Record<string, string> = {}
  for (const [field, savedTab] of Object.entries(saved.fieldAssignments)) {
    fieldAssignments[field] = tabMap[savedTab] ?? savedTab
  }
  return { tabs: matched, fieldAssignments }
}
