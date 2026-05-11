/**
 * getErrorMessage — safely extract a human-readable message from any caught value.
 *
 * Replaces the `err instanceof Error ? err.message : 'fallback'` ternary
 * that appeared 17 times across hooks and components. One source of truth
 * means error formatting, logging, or telemetry can be added here once.
 */
export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string' && err.length > 0) return err
  return fallback
}
