import { useCallback, useEffect, useRef, useState } from 'react'
import type { DownloadStatus, RecipeInfo, WsEvent } from '../types/api'
import { apiPost, useGet } from './useApi'
import { subscribeWs } from './useApi'

/** Extended download status with real-time progress tracking. */
interface DownloadProgressState {
  status: 'downloading'
  progress: number
  speed_mbps: number
  eta_secs: number
  current_file: string
}

/**
 * True when a status update actually changes the progress or status. Used to
 * keep statusMap cached — polling only mutates state when something really
 * changed, avoiding pointless re-renders.
 */
function statusChanged(prev: DownloadStatus | undefined, next: DownloadStatus): boolean {
  if (!prev) return true
  const ps = (prev as any).status
  const ns = (next as any).status
  if (ps !== ns) return true
  if (ns === 'downloading') {
    // Only treat as changed when progress actually moved (>0.01%).
    return Math.abs((prev as any).progress - (next as any).progress) > 0.0001
  }
  return false
}

/** Merge `incoming` into `prev`, only mutating entries that actually changed. */
function mergeChanged(
  prev: Record<string, DownloadStatus>,
  incoming: Record<string, DownloadStatus>,
): Record<string, DownloadStatus> {
  const next = { ...prev }
  let changed = false
  for (const [k, v] of Object.entries(incoming)) {
    if (statusChanged(prev[k], v)) {
      next[k] = v
      changed = true
    }
  }
  // Return the same reference when nothing changed so React bails out.
  return changed ? next : prev
}

/**
 * Normalize the backend's externally-tagged enum into the frontend's
 * field-based DownloadStatus shape.
 *
 * The backend serializes `DownloadStatus` with serde's default external
 * tagging, so a `Cached` variant arrives as `{"cached": {...}}` (status is the
 * object KEY). The frontend's `DownloadStatus` type instead carries a `status`
 * FIELD (`{status: 'cached', ...}`). Without this conversion, `st.status` is
 * `undefined` and cached models never show the "已下载" badge on page load.
 * Values already in field form (e.g. built by WebSocket handlers) pass through.
 */
function normalizeStatus(raw: unknown): DownloadStatus | undefined {
  // Unit variant serializes as a bare string, e.g. "not_cached".
  if (typeof raw === 'string') {
    return { status: 'not_cached' } as DownloadStatus
  }
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, any>
  // Already field-based (e.g. from a WS event) — pass through.
  if ('status' in obj) return obj as DownloadStatus
  if ('cached' in obj) {
    const c = obj.cached ?? {}
    return { status: 'cached', snapshot_id: c.snapshot_id ?? '', size_bytes: c.size_bytes ?? 0 }
  }
  if ('downloading' in obj) {
    const d = obj.downloading ?? {}
    return {
      status: 'downloading',
      progress: d.progress ?? 0,
      speed_mbps: d.speed_mbps ?? 0,
      eta_secs: d.eta_secs ?? 0,
      elapsed_secs: d.elapsed_secs ?? 0,
      current_file: d.current_file ?? '',
    }
  }
  if ('failed' in obj) {
    const f = obj.failed ?? {}
    return { status: 'failed', error: f.error ?? 'unknown error' }
  }
  if ('not_cached' in obj) {
    return { status: 'not_cached' }
  }
  return undefined
}

/** Fetch all recipes and their download statuses. */
export function useRecipes() {
  const { data: recipes, loading, error, refetch } = useGet<RecipeInfo[]>('/api/recipes')

  // Recipes live in the persistent runtime vllm mount, so templates dropped
  // into ~/.aiperf/vllm/recipes/imported/ appear here
  // without a page reload. Poll cheaply; skip background tabs.
  const RECIPES_POLL_MS = 10_000
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refetch()
    }, RECIPES_POLL_MS)
    return () => clearInterval(id)
  }, [refetch])

  // Download status map: model_id -> DownloadStatus
  const [statusMap, setStatusMap] = useState<Record<string, DownloadStatus>>({})

  // Real-time progress overlay (separate from statusMap for smooth updates)
  const [progressMap, setProgressMap] = useState<Record<string, DownloadProgressState>>({})

  // Stable ref to recipes — prevents refreshStatuses from changing on every
  // render when useGet returns a new array reference with identical content.
  const recipesRef = useRef(recipes)
  recipesRef.current = recipes

  // Ref to track if component is mounted
  const mountedRef = useRef(true)
  useEffect(() => {
    return () => { mountedRef.current = false }
  }, [])

  // ── File-first status sync ──────────────────────────────────────────────
  // Synchronises every model's download status in a single bulk request. The
  // backend prioritises reading the persisted `.xpark-downloaded` state files
  // (fast, includes live progress), so this runs proactively on mount /
  // startup / refresh to restore the "已下载" tags and any in-progress state.
  const syncStatusesFromFiles = useCallback(async () => {
    const current = recipesRef.current
    if (!current) return
    const models = [...new Set(current.flatMap(r => [r.model, ...(r.additional_models ?? [])]))]
      .filter((m): m is string => Boolean(m))
    if (models.length === 0) return
    try {
      const res = await fetch('/api/models/status/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ models }),
      })
      if (!res.ok) return
      const data = await res.json()
      // Backend returns externally-tagged enums ({"cached": {...}}) — convert
      // them to the field-based shape the rest of the UI expects.
      const map: Record<string, DownloadStatus> = {}
      for (const [k, v] of Object.entries(data.statuses ?? {})) {
        const norm = normalizeStatus(v)
        if (norm) map[k] = norm
      }
      if (mountedRef.current) {
        // The .xpark-downloaded files are the source of truth for status and
        // progress, so apply them — but only mutate entries that changed.
        setStatusMap(prev => mergeChanged(prev, map))
      }
    } catch { /* ignore */ }
  }, [])

  // Restore live progress for in-flight downloads. Cheap — only touches models
  // that are actively downloading, so it is safe to call on every refresh.
  //
  // Also acts as the authority on WHICH models are genuinely downloading: any
  // statusMap entry claiming "downloading" that is NOT in the backend's active
  // list is a stale state file and is downgraded to "not_cached", so the UI
  // never shows a phantom "正在下载" spinner when nothing is actually running.
  const restoreActiveDownloads = useCallback(async () => {
    try {
      const activeRes = await fetch('/api/models/download/active')
      if (!activeRes.ok) return
      const activeData = await activeRes.json()

      const activeSet = new Set<string>()
      const progressArr: { model: string; progress?: number; current_file?: string }[] =
        Array.isArray(activeData.progress) ? activeData.progress : []
      for (const p of progressArr) activeSet.add(p.model)
      if (Array.isArray(activeData.models)) {
        for (const modelId of activeData.models) activeSet.add(modelId)
      }

      // Clear stale "downloading" entries (state-file leftovers) for models
      // that are not actually downloading right now.
      if (mountedRef.current) {
        setStatusMap(prev => {
          let changed = false
          const next = { ...prev }
          for (const [k, v] of Object.entries(next)) {
            if ((v as any).status === 'downloading' && !activeSet.has(k)) {
              next[k] = { status: 'not_cached' } as DownloadStatus
              changed = true
            }
          }
          return changed ? next : prev
        })
      }

      // Overlay live progress for genuinely active downloads.
      const map: Record<string, DownloadStatus> = {}
      for (const p of progressArr) {
        map[p.model] = {
          status: 'downloading',
          progress: p.progress ?? 0,
          speed_mbps: 0,
          eta_secs: 0,
          current_file: p.current_file || '下载中...',
        } as DownloadStatus
      }
      for (const modelId of activeSet) {
        if (!map[modelId]) {
          map[modelId] = {
            status: 'downloading',
            progress: 0,
            speed_mbps: 0,
            eta_secs: 0,
            current_file: '下载中...',
          } as DownloadStatus
        }
      }
      if (Object.keys(map).length > 0 && mountedRef.current) {
        setStatusMap(prev => mergeChanged(prev, map))
      }
    } catch { /* ignore */ }
  }, [])

  // Init: bulk sync from the state files once recipes load, restoring the
  // cached tags / statuses from disk (fires on mount / startup / refresh).
  useEffect(() => {
    if (recipes && recipes.length > 0) {
      syncStatusesFromFiles()
    }
  }, [recipes, syncStatusesFromFiles])

  // Second-level progress refresh: poll the active-download endpoint (in-memory
  // live progress) so the progress bar updates at ~1s, touching ONLY the models
  // that are actively downloading — reusing the active-progress fetch logic
  // instead of bulk-scanning every model.
  useEffect(() => {
    const id = setInterval(() => {
      restoreActiveDownloads()
    }, 1000)
    return () => clearInterval(id)
  }, [restoreActiveDownloads])

  // Periodic full status reconciliation from the state files. This corrects any
  // stale "downloading" state (e.g. a missed completion event) back to
  // "cached", so a model that is actually downloaded always shows "已下载" —
  // even if the initial mount sync was missed or a WS event was lost.
  useEffect(() => {
    const id = setInterval(() => {
      syncStatusesFromFiles()
    }, 30000)
    return () => clearInterval(id)
  }, [syncStatusesFromFiles])

  // Throttle active-download restore to at most once per 5s
  const lastRestoreRef = useRef(0)
  const throttledRestore = useCallback(() => {
    const now = Date.now()
    if (now - lastRestoreRef.current < 5000) return
    lastRestoreRef.current = now
    restoreActiveDownloads()
  }, [restoreActiveDownloads])

  // Subscribe to WebSocket for real-time download progress
  useEffect(() => {
    return subscribeWs(
      (event: WsEvent) => {
        if (!mountedRef.current) return

        if (event.type === 'download_progress') {
          setProgressMap(prev => {
            return {
              ...prev,
              [event.model]: {
                status: 'downloading',
                progress: event.progress,
                speed_mbps: event.speed_mbps,
                eta_secs: event.eta_secs,
                current_file: event.current_file,
              },
            }
          })
          setStatusMap(prev => {
            const current = prev[event.model]
            if (current && 'status' in current && (current as any).status === 'cached') return prev
            return {
              ...prev,
              [event.model]: {
                status: 'downloading',
                progress: event.progress,
                speed_mbps: event.speed_mbps,
                eta_secs: event.eta_secs,
                current_file: event.current_file,
              } as DownloadStatus,
            }
          })
        } else if (event.type === 'download_complete') {
          setProgressMap(prev => {
            const next = { ...prev }
            delete next[event.model]
            return next
          })
          setStatusMap(prev => ({
            ...prev,
            [event.model]: { status: 'cached', snapshot_id: event.snapshot_id, size_bytes: 0 } as DownloadStatus,
          }))
          throttledRestore()
        } else if (event.type === 'download_failed') {
          setProgressMap(prev => {
            const next = { ...prev }
            delete next[event.model]
            return next
          })
          setStatusMap(prev => ({
            ...prev,
            [event.model]: { status: 'failed', error: event.error } as DownloadStatus,
          }))
        } else if (event.type === 'sync_progress') {
          setStatusMap(prev => ({
            ...prev,
            [event.model]: {
              status: 'downloading',
              progress: event.progress,
              speed_mbps: 0,
              eta_secs: 0,
              current_file: event.message || '同步中...',
            } as DownloadStatus,
          }))
        } else if (event.type === 'sync_complete') {
          throttledRestore()
        }
      },
      // onStatusChange: on reconnect, restore active progress AND reconcile
      // cached tags from the state files (covers completions missed while down).
      (status) => {
        if (status === 'connected' && mountedRef.current) {
          throttledRestore()
          syncStatusesFromFiles()
        }
      },
    )
  }, [throttledRestore, syncStatusesFromFiles])

  /** Trigger download for a model. */
  const triggerDownload = useCallback(async (model: string, token?: string) => {
    await apiPost(`/api/models/download`, { model, token })
    // Optimistically update status
    const progState: DownloadProgressState = {
      status: 'downloading',
      progress: 0,
      speed_mbps: 0,
      eta_secs: 0,
      current_file: '排队中...',
    }
    setProgressMap(prev => ({ ...prev, [model]: progState }))
    setStatusMap(prev => ({
      ...prev,
      [model]: progState as DownloadStatus,
    }))
  }, [])

  /** Cancel a specific model's download. */
  const cancelDownload = useCallback(async (model: string) => {
    await apiPost('/api/models/download/cancel', { model })
    // Optimistically remove from progress map
    setProgressMap(prev => {
      const next = { ...prev }
      delete next[model]
      return next
    })
    setStatusMap(prev => {
      const next = { ...prev }
      delete next[model]
      return next
    })
    // Restore active downloads after cancel
    setTimeout(restoreActiveDownloads, 1000)
  }, [restoreActiveDownloads])

  /** Delete a downloaded model's cached weights from disk. */
  const deleteModel = useCallback(async (model: string) => {
    await apiPost('/api/models/delete', { model })
    setProgressMap(prev => {
      const next = { ...prev }
      delete next[model]
      return next
    })
    setStatusMap(prev => ({
      ...prev,
      [model]: { status: 'not_cached' } as DownloadStatus,
    }))
  }, [])

  /** Check if a model is currently downloading. */
  const isDownloading = useCallback((model: string): boolean => {
    return progressMap[model]?.status === 'downloading' ||
      (statusMap[model] as any)?.status === 'downloading'
  }, [progressMap, statusMap])

  return {
    recipes,
    loading,
    error,
    statusMap,
    progressMap,
    refreshStatuses: restoreActiveDownloads,
    syncStatusesFromFiles,
    triggerDownload,
    cancelDownload,
    deleteModel,
    isDownloading,
    refetch,
  }
}
