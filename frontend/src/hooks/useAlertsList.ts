/**
 * useAlertsList — owns data loading and status update logic for the Alerts admin view.
 *
 * Hides:
 *   - alerts / total / loading / statusFilter / updating state
 *   - loadAlerts useCallback + useEffect (refetches on statusFilter change)
 *   - handleStatusUpdate — optimistically marks updating, calls API, reloads
 */
import { useCallback, useEffect, useState } from 'react'
import { adminGetAlerts, adminUpdateAlertStatus } from '../api/client'
import { getErrorMessage } from '../utils/errorUtils'

export type AlertStatus = 'open' | 'resolved' | 'fixed' | 'all'

export function useAlertsList() {
  const [alerts, setAlerts] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<AlertStatus>('open')
  const [updating, setUpdating] = useState<number | null>(null)

  const loadAlerts = useCallback(() => {
    setLoading(true)
    adminGetAlerts(statusFilter)
      .then((data) => {
        setAlerts(data.alerts)
        setTotal(data.total_alerts)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [statusFilter])

  useEffect(() => {
    loadAlerts()
  }, [loadAlerts])

  async function handleStatusUpdate(fileIndex: number, newStatus: string) {
    setUpdating(fileIndex)
    try {
      await adminUpdateAlertStatus(fileIndex, newStatus)
      loadAlerts()
    } catch (err) {
      alert(getErrorMessage(err, 'Failed to update alert'))
    } finally {
      setUpdating(null)
    }
  }

  return { alerts, total, loading, statusFilter, setStatusFilter, updating, handleStatusUpdate }
}
