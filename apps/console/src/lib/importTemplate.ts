/** Import result surfaced directly to the UI. */
export interface ImportResult {
  ok: boolean
  message: string
}

/** Internal upload outcome: whether the failure is a client/server-side
 *  rejection (no point retrying another way) or a transport failure that
 *  allows falling back to the alternative upload path. */
interface UploadOutcome extends ImportResult {
  fallbackAllowed: boolean
}

const IMPORT_FILE_URL = '/api/recipes/import-file'
const IMPORT_JSON_URL = '/api/recipes/import'

const MAX_POST_ATTEMPTS = 4
const POST_RETRY_DELAY_MS = 800

// Network mounts / cloud-sync providers abort the first on-demand read while
// they materialise the file. Retry generously with exponential backoff so a
// slow provider has time to hydrate before we give up.
const MAX_CHUNK_RETRIES = 12
const READ_RETRY_DELAY_MS = 300
const READ_RETRY_MAX_DELAY_MS = 5000

// Read large files in slices: a small chunk request is far less likely to be
// aborted by the file provider than a whole-file read, and a failed chunk can
// be re-requested without losing previously decoded content.
const READ_CHUNK_SIZE = 4 * 1024 * 1024

/** True for DOMException AbortError — browsers raise this when an in-flight
 *  read or request is killed (connection reset, file provider abort, ...). */
export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
}

/** Extract a message string from any thrown value without relying on
 *  `instanceof Error` (cross-realm DOMExceptions may fail that check). */
function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') {
    return (e as { message: string }).message
  }
  return ''
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/** Backoff schedule for aborted reads: 300ms, 600ms, 1.2s, ... capped at 5s. */
function readRetryDelay(attempt: number): number {
  return Math.min(READ_RETRY_MAX_DELAY_MS, READ_RETRY_DELAY_MS * 2 ** attempt)
}

function readOnce(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'))
    reader.readAsText(file)
  })
}

async function readChunk(file: File, start: number, end: number): Promise<ArrayBuffer> {
  const slice = file.slice(start, end)
  if (typeof slice.arrayBuffer === 'function') {
    return await slice.arrayBuffer()
  }
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'))
    reader.readAsArrayBuffer(slice)
  })
}

/** Read one byte-range with retries. Aborted attempts are re-requested after
 *  an exponentially growing delay — cloud-sync / network mounts often succeed
 *  once the provider finishes materialising the file. */
async function readChunkWithRetry(file: File, start: number, end: number): Promise<ArrayBuffer> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await readChunk(file, start, end)
    } catch (e) {
      if (!isAbortError(e) || attempt >= MAX_CHUNK_RETRIES - 1) throw e
      const wait = readRetryDelay(attempt)
      console.warn(`[import] chunk ${start}-${end} read aborted (attempt ${attempt + 1}/${MAX_CHUNK_RETRIES}); retrying in ${wait}ms`)
      await delay(wait)
    }
  }
}

/** Whole-file text read with the same abort-retry backoff as chunked reads. */
async function readOnceWithRetry(file: File): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await readOnce(file)
    } catch (e) {
      if (!isAbortError(e) || attempt >= MAX_CHUNK_RETRIES - 1) throw e
      const wait = readRetryDelay(attempt)
      console.warn(`[import] whole-file read aborted (attempt ${attempt + 1}/${MAX_CHUNK_RETRIES}); retrying in ${wait}ms`)
      await delay(wait)
    }
  }
}

/** Read a File as text. Small files use a whole-file read; large files are
 *  read in slices with per-slice retries. Aborted reads are retried — the
 *  file provider usually succeeds once it has hydrated the file. */
export async function readFileAsText(file: File): Promise<string> {
  if (file.size <= READ_CHUNK_SIZE) {
    return await readOnceWithRetry(file)
  }
  const decoder = new TextDecoder('utf-8')
  const parts: string[] = []
  for (let start = 0; start < file.size; start += READ_CHUNK_SIZE) {
    const end = Math.min(start + READ_CHUNK_SIZE, file.size)
    const buf = await readChunkWithRetry(file, start, end)
    parts.push(decoder.decode(buf, { stream: true }))
  }
  parts.push(decoder.decode())
  return parts.join('')
}

/** POST the raw File as multipart — the browser streams the bytes itself, so
 *  the page never reads the file in JavaScript. Retries on abort with backoff:
 *  a network-mount file that the provider is still materialising may stream
 *  fine a moment later. */
async function uploadMultipart(file: File): Promise<UploadOutcome> {
  const form = new FormData()
  form.append('file', file)
  console.info('[import] multipart upload start', { name: file.name, size: file.size })
  let lastErr: unknown = null
  for (let attempt = 0; attempt < MAX_POST_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(IMPORT_FILE_URL, { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.accepted) {
        console.warn('[import] multipart rejected', { status: res.status, message: data.message })
        return {
          ok: false,
          fallbackAllowed: false,
          message: data.message ?? `HTTP ${res.status}`,
        }
      }
      console.info('[import] multipart upload ok')
      return { ok: true, fallbackAllowed: false, message: data.message ?? '模板导入成功' }
    } catch (e) {
      lastErr = e
      console.warn('[import] multipart upload failed', { attempt: attempt + 1, error: errorMessage(e) })
      if (isAbortError(e) && attempt < MAX_POST_ATTEMPTS - 1) {
        await delay(POST_RETRY_DELAY_MS * 2 ** attempt)
        continue
      }
      break
    }
  }
  if (isAbortError(lastErr)) {
    console.warn('[import] multipart upload aborted after retries; falling back to JSON path')
    return {
      ok: false,
      fallbackAllowed: true,
      message: '网络连接中断（请求被中止），请稍后重试',
    }
  }
  return { ok: false, fallbackAllowed: true, message: errorMessage(lastErr) || '未知错误' }
}

/** Fallback path: read the file locally and POST it as JSON. */
async function uploadJson(file: File, content: string): Promise<UploadOutcome> {
  const body = JSON.stringify({ filename: file.name, content })
  let lastErr: unknown = null
  for (let attempt = 0; attempt < MAX_POST_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(IMPORT_JSON_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.accepted) {
        return {
          ok: false,
          fallbackAllowed: false,
          message: data.message ?? `HTTP ${res.status}`,
        }
      }
      return { ok: true, fallbackAllowed: false, message: data.message ?? '模板导入成功' }
    } catch (e) {
      lastErr = e
      console.warn('[import] JSON upload failed', { attempt: attempt + 1, error: errorMessage(e) })
      // Connection dropped mid-request (e.g. backend restarting) — retry.
      if (isAbortError(e) && attempt < MAX_POST_ATTEMPTS - 1) {
        await delay(POST_RETRY_DELAY_MS * 2 ** attempt)
        continue
      }
      break
    }
  }
  if (isAbortError(lastErr)) {
    return {
      ok: false,
      fallbackAllowed: false,
      message: '网络连接中断（请求被中止），请稍后重试',
    }
  }
  return { ok: false, fallbackAllowed: false, message: errorMessage(lastErr) || '未知错误' }
}

/** Strip the internal fallback flag from an outcome. */
function asResult(o: UploadOutcome): ImportResult {
  return { ok: o.ok, message: o.message }
}

/** Import a picked YAML template.
 *
 *  Primary path is a direct multipart upload (no client-side file read —
 *  FileReader aborts on network mounts / cloud-sync files are bypassed).
 *  Falls back to reading the file and posting JSON when the transport fails,
 *  in case the browser cannot stream the file. */
export async function importTemplate(file: File): Promise<ImportResult> {
  console.info('[import] start', { name: file.name, size: file.size, type: file.type })
  const multipart = await uploadMultipart(file)
  if (multipart.ok || !multipart.fallbackAllowed) {
    return asResult(multipart)
  }

  console.info('[import] fallback: reading file locally for JSON upload')
  let content: string
  try {
    content = await readFileAsText(file)
  } catch (e) {
    const detail = errorMessage(e)
    console.error('[import] local file read failed', { detail })
    return {
      ok: false,
      message: `浏览器无法读取所选文件${detail ? `（${detail}）` : ''}：文件可能位于网络挂载盘、云同步盘或已被移动/删除，请将其复制到本机磁盘后重试`,
    }
  }
  if (!content.trim()) {
    console.warn('[import] file content is empty')
    return { ok: false, message: '文件内容为空' }
  }
  return asResult(await uploadJson(file, content))
}
