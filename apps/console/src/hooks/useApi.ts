import { useCallback, useEffect, useState } from 'react'

const BASE = ''

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    let message = text
    try {
      const parsed = JSON.parse(text) as { message?: string }
      message = parsed.message ?? text
    } catch { /* response is not JSON */ }
    throw new Error(message || `HTTP ${res.status}: ${res.statusText}`)
  }
  return res.json()
}

/** Simple GET hook with auto-refetch. */
export function useGet<T>(path: string | null, intervalMs = 0) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch_ = useCallback(async () => {
    if (!path) return
    try {
      setLoading(true)
      const result = await request<T>('GET', path)
      setData(result)
      setError(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => {
    fetch_()
    if (intervalMs > 0) {
      const id = setInterval(fetch_, intervalMs)
      return () => clearInterval(id)
    }
  }, [fetch_, intervalMs])

  return { data, loading, error, refetch: fetch_ }
}

/** POST helper. */
export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, body)
}

/** DELETE helper. */
export async function apiDelete<T>(path: string): Promise<T> {
  return request<T>('DELETE', path)
}

/** PUT helper. */
export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('PUT', path, body)
}

/** Subscribe to typed WebSocket events. Returns unsubscribe function. */
export function subscribeWs(
  onEvent: (event: any) => void,
  onStatusChange?: (status: 'connected' | 'reconnecting' | 'disconnected') => void,
): () => void {
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let attempt = 0
  let closed = false

  function connect() {
    if (closed) return
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    ws = new WebSocket(`${proto}//${window.location.host}/ws`)

    ws.onopen = () => {
      attempt = 0
      onStatusChange?.('connected')
    }

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data)
        onEvent(data)
      } catch { /* ignore */ }
    }

    ws.onclose = () => {
      ws = null
      if (closed) return
      onStatusChange?.('reconnecting')
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000)
      attempt++
      reconnectTimer = setTimeout(connect, delay)
    }

    ws.onerror = () => ws?.close()
  }

  connect()

  return () => {
    closed = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    ws?.close()
  }
}
