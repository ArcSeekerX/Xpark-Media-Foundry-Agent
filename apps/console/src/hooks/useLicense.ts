import { useCallback, useState } from 'react'
import { apiPost, useGet } from './useApi'

export interface LicenseInfo {
  /** Compile-time global switch: false when the backend was built without
   *  the license feature — the UI hides itself and nothing is gated. */
  enabled: boolean
  activated: boolean
  expired: boolean
  /** System clock rolled back past the recorded high-water mark. */
  clock_rolled_back: boolean
  expires_at: number | null
  days_left: number | null
  gpu_uuid: string | null
  masked_code: string | null
}

/** License state shared across the app. Polls slowly so expiry state stays
 *  fresh; `activate` submits an offline license code bound to the GPU UUID. */
export function useLicense() {
  const { data, refetch } = useGet<LicenseInfo>('/api/license', 60_000)
  const [activating, setActivating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activate = useCallback(async (code: string): Promise<boolean> => {
    setActivating(true)
    setError(null)
    try {
      await apiPost('/api/license/activate', { license: code })
      await refetch()
      return true
    } catch (e) {
      let msg = e instanceof Error ? e.message : '激活失败'
      msg = msg.replace(/^HTTP \d+: /, '')
      try {
        const parsed = JSON.parse(msg)
        if (parsed?.error) msg = parsed.error
      } catch { /* plain-text error, keep as-is */ }
      setError(msg)
      return false
    } finally {
      setActivating(false)
    }
  }, [refetch])

  return {
    license: data ?? null,
    /** True when the backend confirmed an active, non-expired license with no
     *  clock-rollback detection. `null` (feature disabled at build time, or
     *  endpoint unknown) means "not enforced" — the UI shows no license
     *  affordance at all. */
    licensed: data && data.enabled ? (data.activated && !data.expired && !data.clock_rolled_back) : null,
    activate,
    activating,
    error,
    refetch,
  }
}
