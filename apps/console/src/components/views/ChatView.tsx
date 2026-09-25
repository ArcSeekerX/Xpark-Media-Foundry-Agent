import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Brain, ChevronDown, ChevronLeft, ChevronRight, ImagePlus, MessageSquare, Plus, SlidersHorizontal, Trash2, X } from 'lucide-react'
import type { EngineSnapshot } from '../../types/metrics'
import type { ChatImage, ChatMessage } from '../../types/chat'
import { useChatSessions } from '../../hooks/useChatSessions'
import { mockChatCompletion, MOCK_ENABLED } from '../../mock/chat'

interface Props {
  engines: EngineSnapshot[]
}

const MAX_IMAGES = 4
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

function readImage(file: File): Promise<ChatImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ name: file.name, data_url: String(reader.result) })
    reader.onerror = () => reject(new Error(`无法读取图片：${file.name}`))
    reader.readAsDataURL(file)
  })
}

function requestContent(message: ChatMessage): string | Array<Record<string, unknown>> {
  if (!message.images?.length) return message.content
  return [
    ...(message.content ? [{ type: 'text', text: message.content }] : []),
    ...message.images.map(image => ({
      type: 'image_url',
      image_url: { url: image.data_url },
    })),
  ]
}

interface ParamSliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}

function ParamSlider({ label, value, min, max, step, onChange }: ParamSliderProps) {  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(String(value))

  const handleSlide = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value)
    onChange(v)
    setEditText(String(v))
  }

  const handleInputBlur = () => {
    setEditing(false)
    const v = parseFloat(editText)
    if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)))
    setEditText(String(value))
  }

  const handleInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleInputBlur()
  }

  useEffect(() => { setEditText(String(value)) }, [value])

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-[11px] text-zinc-400">{label}</span>
        {editing ? (
          <input
            autoFocus
            value={editText}
            onChange={e => setEditText(e.target.value)}
            onBlur={handleInputBlur}
            onKeyDown={handleInputKey}
            className="w-16 text-right text-[11px] bg-white/[0.06] border border-white/[0.1] rounded px-1 py-0.5 text-zinc-200 outline-none"
          />
        ) : (
          <button onClick={() => setEditing(true)} className="text-[11px] text-zinc-300 hover:text-zinc-100 tabular-nums cursor-text">
            {value}
          </button>
        )}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleSlide}
        className="w-full h-1 appearance-none bg-white/[0.08] rounded-full outline-none cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#76B900] [&::-webkit-slider-thumb]:cursor-pointer"
      />
      <div className="flex justify-between text-[9px] text-zinc-700">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}

interface ThinkingBlockProps {
  reasoning: string
  /** True while the message is still streaming — shows a live indicator. */
  live: boolean
}

function ThinkingBlock({ reasoning, live }: ThinkingBlockProps) {
  const [open, setOpen] = useState(true)
  return (
    <div className="mb-2 rounded-md border border-white/[0.08] bg-white/[0.02]">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-left cursor-pointer"
      >
        <Brain size={12} className="text-[#76B900]/70 shrink-0" />
        <span className="text-[11px] text-zinc-500">思考过程</span>
        {live && (
          <span className="text-[10px] text-[#76B900] animate-pulse">思考中…</span>
        )}
        <ChevronDown
          size={12}
          className={`ml-auto text-zinc-600 transition-transform ${open ? '' : '-rotate-90'}`}
        />
      </button>
      {open && (
        <pre className="px-2.5 pb-2 pt-1.5 border-t border-white/[0.06] text-xs text-zinc-500 whitespace-pre-wrap font-sans leading-relaxed m-0">
          {reasoning}
        </pre>
      )}
    </div>
  )
}

export function ChatView({ engines }: Props) {
  const runningEngines = engines.filter(e => e.status.type === 'Running')
  const { sessions, activeSessionId, activeSession, createSession, selectSession, deleteSession, updateSession, refreshSession } = useChatSessions()
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>('')
  const [input, setInput] = useState('')
  const [images, setImages] = useState<ChatImage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showParams, setShowParams] = useState(true)
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(8192)
  const [topP, setTopP] = useState(0.9)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  /** Locally-displayed in-flight exchange. The backend generation task owns
   *  the persisted session; this overlay shows what is being generated. */
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([])
  /** A server-side generation for the active session is still running
   *  (e.g. after a page refresh) — poll the session until it finishes. */
  const [generating, setGenerating] = useState(false)

  const messages = useMemo(() => {
    const base = activeSession?.messages ?? []
    return liveMessages.length > 0 ? [...base, ...liveMessages] : base
  }, [activeSession, liveMessages])

  // Default to the first running engine when no endpoint is selected yet.
  useEffect(() => {
    if (!selectedEndpoint && runningEngines.length > 0) {
      setSelectedEndpoint(runningEngines[0].endpoint)
    }
  }, [runningEngines, selectedEndpoint])

  // Follow the endpoint of the active session when switching sessions.
  useEffect(() => {
    if (activeSession) setSelectedEndpoint(activeSession.endpoint)
  }, [activeSession?.id])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const selectedEngine = runningEngines.find(e => e.endpoint === selectedEndpoint)
  const [modelName, setModelName] = useState('Unknown')

  // Fetch actual model name from backend proxy
  useEffect(() => {
    if (!selectedEndpoint) return
    setModelName(selectedEngine?.model?.model_type ?? 'Unknown')
    fetch(`/api/chat/models?endpoint=${encodeURIComponent(selectedEndpoint)}`)
      .then(r => r.json())
      .then(d => { if (d.model) setModelName(d.model) })
      .catch(() => {})
  }, [selectedEndpoint])

  const handleNewSession = useCallback(() => {
    createSession(selectedEndpoint || runningEngines[0]?.endpoint || '')
    setImages([])
    setError(null)
  }, [createSession, selectedEndpoint, runningEngines])

  const handleSelectSession = useCallback((id: string) => {
    selectSession(id)
    setImages([])
    setError(null)
  }, [selectSession])

  const handleEndpointChange = useCallback((next: string) => {
    setSelectedEndpoint(next)
    if (activeSession) updateSession(activeSession.id, { endpoint: next })
    setImages([])
    setError(null)
  }, [activeSession, updateSession])

  const handleSend = useCallback(async () => {
    if ((!input.trim() && images.length === 0) || !selectedEndpoint || streaming) return

    let sessionId = activeSession?.id
    let history = activeSession?.messages ?? []
    if (!sessionId) {
      sessionId = createSession(selectedEndpoint)
      history = []
    }

    const userMsg: ChatMessage = {
      role: 'user',
      content: input.trim(),
      images: images.length > 0 ? images : undefined,
    }
    const requestMessages = [...history, userMsg]
    setInput('')
    setImages([])
    setStreaming(true)
    setError(null)
    setGenerating(true)

    // Show the exchange locally — the backend generation task persists it
    // into the session (server-side generation survives page refreshes).
    let liveAssistant: ChatMessage = { role: 'assistant', content: '', reasoning: '' }
    setLiveMessages([userMsg, liveAssistant])

    try {
      const res = MOCK_ENABLED
        ? await mockChatCompletion(requestMessages)
        : await fetch('/api/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              endpoint: selectedEndpoint,
              model: modelName,
              messages: requestMessages.map(m => ({ role: m.role, content: requestContent(m) })),
              stream: true,
              temperature,
              max_tokens: maxTokens,
              top_p: topP,
              session_id: sessionId,
            }),
          })

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      const processLine = (line: string) => {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) return
        const data = trimmed.slice(6)
        if (data === '[DONE]') return
        let parsed: any
        try {
          parsed = JSON.parse(data)
        } catch {
          return
        }
        if (parsed.error?.message) {
          throw new Error(String(parsed.error.message))
        }
        const delta = parsed.choices?.[0]?.delta
        const contentDelta = typeof delta?.content === 'string' ? delta.content : ''
        // Thinking-enabled models stream their reasoning as
        // `reasoning_content` (OpenAI-compatible) or `reasoning`.
        const reasoningDelta = typeof delta?.reasoning_content === 'string'
          ? delta.reasoning_content
          : typeof delta?.reasoning === 'string' ? delta.reasoning : ''
        if (contentDelta || reasoningDelta) {
          liveAssistant = {
            role: 'assistant',
            content: liveAssistant.content + contentDelta,
            reasoning: (liveAssistant.reasoning ?? '') + reasoningDelta,
          }
          setLiveMessages([userMsg, liveAssistant])
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) processLine(line)
      }
      // Flush the decoder and process any remaining unterminated line —
      // some servers end the stream without a trailing newline, and
      // multi-byte characters may still sit in the decoder buffer.
      buffer += decoder.decode()
      for (const line of buffer.split('\n')) processLine(line)

      // Done: the backend finalised the session (with the clean-end flag) —
      // reload it so the UI shows the authoritative state.
      setLiveMessages([])
      if (MOCK_ENABLED) {
        // No backend to persist to — commit the exchange into local state.
        updateSession(sessionId, { messages: [...requestMessages, liveAssistant] })
      } else {
        void refreshSession(sessionId)
      }
    } catch (e: any) {
      setError(e.message ?? 'Request failed')
      // The backend records the interruption — reload the session so the
      // partial reply shows with the 中断 signal.
      setLiveMessages([])
      if (!MOCK_ENABLED) setTimeout(() => { void refreshSession(sessionId) }, 500)
    } finally {
      setStreaming(false)
      // Give the backend a moment to finish its final session write.
      setTimeout(() => { setGenerating(false) }, 1000)
    }
  }, [input, images, selectedEndpoint, streaming, activeSession, createSession, updateSession, refreshSession, modelName, temperature, maxTokens, topP])

  const handleImagesSelected = useCallback(async (files: FileList | null) => {
    if (!files?.length) return
    const selected = Array.from(files)
    if (images.length + selected.length > MAX_IMAGES) {
      setError(`每条消息最多上传 ${MAX_IMAGES} 张图片`)
      return
    }
    const invalid = selected.find(file => !file.type.startsWith('image/') || file.size > MAX_IMAGE_BYTES)
    if (invalid) {
      setError(`图片必须小于 5 MB：${invalid.name}`)
      return
    }
    try {
      const loaded = await Promise.all(selected.map(readImage))
      setImages(current => [...current, ...loaded])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '图片读取失败')
    } finally {
      if (imageInputRef.current) imageInputRef.current.value = ''
    }
  }, [images.length])

  // After a refresh/switch, the backend may still be generating for the
  // active session — poll it (1s) until the generation completes.
  useEffect(() => {
    if (MOCK_ENABLED) return
    if (!activeSession || activeSession.id.length === 0) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const check = async () => {
      try {
        const res = await fetch(`/api/chat/sessions/${activeSession.id}/generating`)
        if (!res.ok || stopped) return
        const data = await res.json()
        if (stopped) return
        if (data.generating) {
          setGenerating(true)
          await refreshSession(activeSession.id)
          timer = setTimeout(check, 1000)
        } else {
          setGenerating(false)
          await refreshSession(activeSession.id)
        }
      } catch {
        if (!stopped) timer = setTimeout(check, 2000)
      }
    }
    check()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [activeSession?.id, refreshSession])

  return (
    <div className="flex-1 min-h-0 flex gap-4">
      {/* Session sidebar */}
      <div className="w-44 shrink-0 border-r border-white/[0.06] pr-3 flex flex-col gap-2">
        <button
          onClick={handleNewSession}
          disabled={streaming}
          className="flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md border border-white/[0.08] bg-white/[0.03] text-zinc-300 hover:text-[#76B900] hover:border-[#76B900]/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          <Plus size={14} />
          新建会话
        </button>
        <div className="flex-1 overflow-y-auto space-y-0.5">
          {sessions.length === 0 && (
            <div className="text-[11px] text-zinc-600 px-2 py-3 text-center">
              暂无会话
            </div>
          )}
          {sessions.map(s => {
            const active = s.id === activeSessionId
            return (
              <div
                key={s.id}
                className={`group flex items-center rounded-md px-2 py-1.5 gap-1.5 text-xs transition-colors ${
                  active
                    ? 'bg-[#76B900]/[0.12] text-[#76B900]'
                    : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
                }`}
              >
                <button
                  onClick={() => handleSelectSession(s.id)}
                  disabled={streaming}
                  className="flex-1 min-w-0 text-left truncate flex items-center gap-1.5 disabled:cursor-not-allowed"
                  title={`${s.title}${s.interrupted ? '（生成已中断）' : ''}`}
                >
                  <MessageSquare size={12} className="shrink-0 opacity-60" />
                  {s.interrupted && (
                    <span className="shrink-0 text-amber-400" title="生成已中断">⚠</span>
                  )}
                  <span className="truncate">{s.title}</span>
                </button>
                <button
                  onClick={() => deleteSession(s.id)}
                  disabled={streaming}
                  className="shrink-0 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity disabled:cursor-not-allowed"
                  title="删除会话"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Engine selector */}
        <div className="flex items-center gap-2 mb-3 shrink-0">
          <span className="text-xs text-zinc-500">模型：</span>
          <div className="relative">
            <select
              value={selectedEndpoint}
              onChange={e => handleEndpointChange(e.target.value)}
              className="bg-white/[0.04] border border-white/[0.08] rounded-md px-2 py-1 text-xs text-zinc-300 outline-none focus:border-[#76B900] appearance-none cursor-pointer"
            >
              {runningEngines.length === 0 && <option value="">暂无运行中的模型</option>}
              {selectedEndpoint && !runningEngines.some(e => e.endpoint === selectedEndpoint) && (
                <option value={selectedEndpoint}>{selectedEndpoint.replace(/^https?:\/\//, '')}（离线）</option>
              )}
              {runningEngines.map(e => {
                const addr = e.endpoint.replace(/^https?:\/\//, '')
                return (
                  <option key={e.endpoint} value={e.endpoint} label={modelName}>
                    {modelName} -- {addr}
                  </option>
                )
              })}
            </select>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1 mb-3">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
              选择一个模型，开始对话
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              {/* Avatar */}
              <div className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold ${
                msg.role === 'user'
                  ? 'bg-[#76B900]/20 text-[#76B900]'
                  : 'bg-zinc-700/50 text-zinc-400'
              }`}>
                {msg.role === 'user' ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <path d="M9 9h6M9 13h6M9 17h4"/>
                  </svg>
                )}
              </div>
              {/* Bubble */}
              <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-[#76B900]/15 text-zinc-200'
                  : 'bg-white/[0.04] text-zinc-300'
              }`}>
                {msg.role === 'assistant' && msg.reasoning && (
                  <ThinkingBlock
                    reasoning={msg.reasoning}
                    live={streaming && i === messages.length - 1}
                  />
                )}
                {msg.role === 'assistant' &&
                  !streaming && !generating &&
                  activeSession?.interrupted &&
                  i === messages.length - 1 && (
                    <div className="mb-1.5 flex items-center gap-1 text-[11px] text-amber-400">
                      <span className="shrink-0">⚠</span>
                      <span>生成已中断，内容不完整</span>
                    </div>
                  )}
                {msg.images && msg.images.length > 0 && (
                  <div className={`grid gap-2 mb-2 ${msg.images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    {msg.images.map((image, imageIndex) => (
                      <img
                        key={`${image.name}-${imageIndex}`}
                        src={image.data_url}
                        alt={image.name}
                        className="max-h-64 max-w-full rounded-md object-contain"
                      />
                    ))}
                  </div>
                )}
                <pre className="whitespace-pre-wrap font-sans text-sm m-0 leading-relaxed">
                  {msg.content || (streaming && i === messages.length - 1 ? '...' : '')}
                  {!streaming && generating && messages.length > 0 && i === messages.length - 1 && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-zinc-600 ml-1">
                      <span className="w-1 h-1 rounded-full bg-[#76B900] animate-pulse" />
                      生成中…
                    </span>
                  )}
                </pre>
              </div>
            </div>
          ))}
          {error && <div className="text-red-400 text-xs text-center">{error}</div>}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="shrink-0 space-y-2">
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 rounded-md border border-white/[0.08] bg-white/[0.02] p-2">
              {images.map((image, index) => (
                <div key={`${image.name}-${index}`} className="group/image relative">
                  <img src={image.data_url} alt={image.name} className="h-16 w-16 rounded object-cover" />
                  <button
                    type="button"
                    onClick={() => setImages(current => current.filter((_, i) => i !== index))}
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-zinc-800 p-0.5 text-zinc-300 shadow hover:bg-red-500 hover:text-white"
                    title={`移除 ${image.name}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={e => void handleImagesSelected(e.target.files)}
            />
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={streaming || !selectedEndpoint || images.length >= MAX_IMAGES}
              className="flex items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.04] px-3 text-zinc-400 transition-colors hover:border-[#76B900]/40 hover:text-[#76B900] disabled:cursor-not-allowed disabled:opacity-40"
              title={`上传图片（最多 ${MAX_IMAGES} 张，每张不超过 5 MB）`}
            >
              <ImagePlus size={17} />
            </button>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder={images.length > 0 ? '输入图片相关问题（可选）...' : '输入消息...'}
              disabled={streaming || !selectedEndpoint}
              className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-md px-3 py-2 text-sm text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-[#76B900] disabled:opacity-40"
            />
            <button
              onClick={handleSend}
              disabled={streaming || (!input.trim() && images.length === 0) || !selectedEndpoint}
              className="px-4 py-2 text-sm font-medium rounded-md bg-[#76B900] text-[#08080a] hover:bg-[#8cd41a] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {streaming ? '...' : '发送'}
            </button>
          </div>
        </div>
      </div>

      {/* Parameters sidebar */}
      {showParams ? (
        <div className="w-56 shrink-0 border-l border-white/[0.06] pl-4 pr-2 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-zinc-400">生成参数</h3>
            <button
              onClick={() => setShowParams(false)}
              className="text-zinc-500 hover:text-zinc-300 p-0.5 rounded"
              title="折叠参数面板"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <ParamSlider label="Temperature" value={temperature} min={0} max={2} step={0.05} onChange={setTemperature} />
          <ParamSlider label="Top P" value={topP} min={0} max={1} step={0.05} onChange={setTopP} />
          <ParamSlider label="Max Tokens" value={maxTokens} min={1} max={16384} step={1} onChange={setMaxTokens} />
        </div>
      ) : (
        <button
          onClick={() => setShowParams(true)}
          className="shrink-0 flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 border border-white/[0.08] hover:border-white/[0.15] rounded-l-md py-2 px-1.5 transition-colors group self-start"
          title="展开参数面板"
        >
          <ChevronLeft size={14} />
          <SlidersHorizontal size={14} className="group-hover:text-[#76B900] transition-colors" />
        </button>
      )}
    </div>
  )
}
