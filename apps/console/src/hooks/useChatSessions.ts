import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage, ChatSession } from '../types/chat'

/**
 * Chat sessions are persisted server-side under `~/.aiperf/sessions/` via
 * the /api/chat/sessions REST API. Sessions load on mount; writes are
 * debounced (streaming updates many times per second) and flushed on
 * tab hide / unmount. The active-session pointer stays in localStorage
 * (client-side preference only).
 */

const ACTIVE_KEY = 'xpark-ai-perf:chat-active-session'
const LEGACY_SESSIONS_KEY = 'xpark-ai-perf:chat-sessions'
const UNTITLED = '新会话'
const TITLE_MAX_LEN = 24
/** Drop the oldest sessions past this cap on the server. */
const MAX_SESSIONS = 100
/** Debounce window for session writes while streaming (ms). */
const SAVE_DEBOUNCE_MS = 400

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function isMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false
  const m = value as Record<string, unknown>
  const imagesValid = m.images === undefined || (
    Array.isArray(m.images) && m.images.every(image => {
      if (!image || typeof image !== 'object') return false
      const entry = image as Record<string, unknown>
      return typeof entry.name === 'string' && typeof entry.data_url === 'string'
    })
  )
  return (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && imagesValid
}

function normalizeSession(value: unknown): ChatSession | null {
  if (!value || typeof value !== 'object') return null
  const s = value as Record<string, unknown>
  if (
    typeof s.id !== 'string' ||
    s.id.length === 0 ||
    typeof s.endpoint !== 'string' ||
    !Array.isArray(s.messages) ||
    !s.messages.every(isMessage)
  ) {
    return null
  }
  const createdAt = typeof s.created_at === 'number'
    ? s.created_at
    : typeof s.createdAt === 'number' ? s.createdAt : 0
  return {
    id: s.id,
    title: typeof s.title === 'string' && s.title.length > 0 ? s.title : UNTITLED,
    endpoint: s.endpoint,
    created_at: createdAt,
    messages: s.messages as ChatMessage[],
    interrupted: s.interrupted === true,
  }
}

/** Legacy localStorage sessions (pre server-side persistence), used only to
 *  migrate old conversations and as an offline fallback cache. */
function readLegacySessions(): ChatSession[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(LEGACY_SESSIONS_KEY)
    if (raw === null) return []
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.map(normalizeSession).filter((s): s is ChatSession => s !== null)
  } catch {
    return []
  }
}

function readActiveId(ids: string[]): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(ACTIVE_KEY)
    return raw !== null && ids.includes(raw) ? raw : null
  } catch {
    return null
  }
}

function writeActiveId(id: string | null): void {
  try {
    if (id === null) window.localStorage.removeItem(ACTIVE_KEY)
    else window.localStorage.setItem(ACTIVE_KEY, id)
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
}

/** Derive a session title from its first user message. */
function deriveTitle(messages: ChatMessage[]): string | null {
  const first = messages.find((m) => m.role === 'user' && (m.content.trim().length > 0 || (m.images?.length ?? 0) > 0))
  if (!first) return null
  const content = first.content.trim().replace(/\s+/g, ' ')
  return (content || '图片').slice(0, TITLE_MAX_LEN)
}

export interface UseChatSessionsResult {
  /** All sessions, newest first. */
  sessions: ChatSession[]
  activeSessionId: string | null
  activeSession: ChatSession | null
  /** Creates and activates a new session, returning its id. */
  createSession: (endpoint: string) => string
  selectSession: (id: string) => void
  deleteSession: (id: string) => void
  updateSession: (id: string, patch: Partial<Pick<ChatSession, 'title' | 'endpoint' | 'messages'>>) => void
  /** Reload one session from the server (no write-back). */
  refreshSession: (id: string) => Promise<void>
}

/**
 * Server-backed multi-session chat state. Sessions load from the backend on
 * mount (migrating legacy localStorage conversations that were not yet
 * uploaded); every mutation schedules a debounced save.
 */
export function useChatSessions(): UseChatSessionsResult {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  const sessionsRef = useRef<ChatSession[]>([])
  const dirtyRef = useRef<Set<string>>(new Set())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  const persist = useCallback(async (session: ChatSession) => {
    try {
      await fetch(`/api/chat/sessions/${session.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(session),
      })
    } catch {
      // offline / backend down — the next save attempt retries
    }
  }, [])

  /** Write all dirty sessions now (debounce flush). */
  const flushDirty = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const dirty = [...dirtyRef.current]
    dirtyRef.current.clear()
    for (const id of dirty) {
      const session = sessionsRef.current.find((s) => s.id === id)
      if (session) await persist(session)
    }
  }, [persist])

  /** Schedule a debounced write for one session. */
  const scheduleSave = useCallback((id: string) => {
    dirtyRef.current.add(id)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void flushDirty()
    }, SAVE_DEBOUNCE_MS)
  }, [flushDirty])

  // Load sessions on mount; migrate legacy localStorage sessions once.
  useEffect(() => {
    let alive = true
    void (async () => {
      let serverSessions: ChatSession[] = []
      let legacy: ChatSession[] = []
      try {
        const res = await fetch('/api/chat/sessions')
        if (res.ok) {
          const data: unknown = await res.json()
          if (Array.isArray(data)) {
            serverSessions = data.map(normalizeSession).filter((s): s is ChatSession => s !== null)
          }
        }
      } catch {
        // backend unreachable — fall back to the legacy storage cache
        legacy = readLegacySessions()
      }
      if (!alive) return

      // Upload legacy sessions missing on the server (pre-server persistence).
      const legacyOnly = legacy.filter((l) => !serverSessions.some((s) => s.id === l.id))
      void (async () => {
        for (const s of legacyOnly) {
          await persist(s)
        }
        if (legacyOnly.length > 0) {
          try {
            window.localStorage.removeItem(LEGACY_SESSIONS_KEY)
          } catch {
            /* ignore */
          }
        }
      })()

      const merged = [...legacyOnly, ...serverSessions]
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, MAX_SESSIONS)
      setSessions(merged)
      const active = readActiveId(merged.map((s) => s.id))
      setActiveSessionId(active ?? merged[0]?.id ?? null)
    })()
    return () => {
      alive = false
    }
  }, [persist])

  // Flush pending writes on tab hide / unmount so the latest streaming
  // content is persisted even on an immediate refresh.
  const flushRef = useRef<() => void>(() => {})
  flushRef.current = () => {
    if (saveTimer.current || dirtyRef.current.size > 0) void flushDirty()
  }
  useEffect(() => {
    const onHide = () => flushRef.current()
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      flushRef.current()
    }
  }, [])

  const createSession = useCallback(
    (endpoint: string) => {
      const session: ChatSession = {
        id: genId(),
        title: UNTITLED,
        endpoint,
        created_at: Date.now(),
        messages: [],
      }
      setSessions((prev) => [session, ...prev].slice(0, MAX_SESSIONS))
      setActiveSessionId(session.id)
      writeActiveId(session.id)
      // Persist immediately (not debounced) so a server-side generation
      // started right after finds the session on disk.
      void persist(session)
      return session.id
    },
    [persist],
  )

  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id)
    writeActiveId(id)
  }, [])

  const deleteSession = useCallback(
    (id: string) => {
      dirtyRef.current.delete(id)
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id)
        return next
      })
      setActiveSessionId((prevActive) => {
        const next = prevActive === id ? null : prevActive
        writeActiveId(next)
        return next
      })
      void fetch(`/api/chat/sessions/${id}`, { method: 'DELETE' }).catch(() => {})
    },
    [],
  )

  const updateSession = useCallback(
    (id: string, patch: Partial<Pick<ChatSession, 'title' | 'endpoint' | 'messages'>>) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s
          let title = patch.title ?? s.title
          if (patch.messages && title === UNTITLED) {
            title = deriveTitle(patch.messages) ?? UNTITLED
          }
          return { ...s, ...patch, title }
        }),
      )
      scheduleSave(id)
    },
    [scheduleSave],
  )

  /** Refresh one session from the server without writing back — used while
   *  a server-side generation is filling the session file. */
  const refreshSession = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/chat/sessions/${id}`)
      if (!res.ok) return
      const data: unknown = await res.json()
      const session = normalizeSession(data)
      if (!session) return
      setSessions((prev) => {
        const exists = prev.some((s) => s.id === session.id)
        const next = exists
          ? prev.map((s) => (s.id === session.id ? session : s))
          : [session, ...prev]
        return next
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, MAX_SESSIONS)
      })
    } catch {
      /* offline — hook keeps the current state */
    }
  }, [])

  // Keep the active pointer valid: fall back to the newest session when the
  // stored id is missing, and clear it when there are no sessions at all.
  useEffect(() => {
    if (sessions.length === 0) {
      if (activeSessionId !== null) setActiveSessionId(null)
      return
    }
    if (activeSessionId === null || !sessions.some((s) => s.id === activeSessionId)) {
      setActiveSessionId(sessions[0].id)
    }
  }, [sessions, activeSessionId])

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  )

  return { sessions, activeSessionId, activeSession, createSession, selectSession, deleteSession, updateSession, refreshSession }
}
