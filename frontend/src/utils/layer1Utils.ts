/**
 * toLayer1Result — canonical mapping from Layer1Response (API shape) to
 * Layer1Result (UI/wizard shape).
 *
 * The two differ in one key: the API returns `sheetName` while the wizard
 * uses `sourceSheet` (which the caller computes — a tab name or "PDF pages …").
 * Both hooks previously inlined this 4-field spread and cast `as Layer1Result`.
 */
import type { Layer1Response, Layer1Result } from '../types'

export function toLayer1Result(raw: Layer1Response, sourceSheet: string): Layer1Result {
  return {
    lineItems: raw.lineItems,
    sourceScaling: raw.sourceScaling,
    columnIdentified: raw.columnIdentified,
    sourceSheet,
    structured: raw.structured,
    templateCheck: raw.templateCheck,
  }
}
