export interface ChatImage {
  name: string
  data_url: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** Images attached to a user message, persisted as data URLs. */
  images?: ChatImage[]
  /** Model reasoning/thinking output (e.g. `reasoning_content` for
   *  thinking-enabled models). Not sent back in history. */
  reasoning?: string
}

export interface ChatSession {
  id: string
  title: string
  /** vLLM endpoint this session talks to. */
  endpoint: string
  /** Unix timestamp (ms) of session creation. */
  created_at: number
  messages: ChatMessage[]
  /** True when the last generation for this session was interrupted. */
  interrupted?: boolean
}
