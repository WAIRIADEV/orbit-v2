// Talks to Groq's OpenAI-compatible API. The key never leaves the main process.

/** Best first. Groq retires models often, so this is only a preference: the live model list decides. */
export const PREFERRED_MODELS = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'qwen/qwen3.6-27b', 'llama-3.3-70b-versatile']
export const FALLBACK_MODEL = PREFERRED_MODELS[0] as string

/** Picks a chat model that can use tools from the ids Groq lists. Never picks speech, safety or guard models. */
export function pickModel(ids: string[]): string | null {
  for (const p of PREFERRED_MODELS) if (ids.includes(p)) return p
  const ok = ids.filter((id) => !/whisper|tts|guard|safeguard|embed|compound|orpheus|playai|distil/i.test(id))
  return ok.find((id) => /gpt-oss|qwen|llama.*(70b|versatile)|kimi/i.test(id)) ?? null
}
const BASE = 'https://api.groq.com/openai/v1'

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface Completion {
  content: string
  toolCalls: ToolCall[]
}

export type AiErrorCode = 'no-key' | 'bad-key' | 'rate' | 'network' | 'other' | 'model-gone'

export class AiError extends Error {
  readonly code: AiErrorCode
  readonly retryable: boolean
  constructor(code: AiErrorCode, message: string, retryable = false) {
    super(message)
    this.code = code
    this.retryable = retryable
  }
}

export type CompleteFn = (messages: ChatMessage[], signal: AbortSignal) => Promise<Completion>
type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
}>

/** Seconds to wait, from the Retry-After header or Groq's "Please try again in 3.5s" wording. */
export function retrySeconds(header: string | null, message: string): number | null {
  const h = header ? Number(header) : NaN
  if (Number.isFinite(h) && h > 0) return Math.ceil(h)
  const m = /try again in (?:(\d+)m)?\s*(\d+(?:\.\d+)?)s/i.exec(message)
  if (m) return Math.ceil(Number(m[1] ?? 0) * 60 + Number(m[2]))
  return null
}

/** Turns an HTTP failure into something a person can act on. Pure, so it is tested. */
export function mapHttpError(status: number, bodyText: string, retryAfter: string | null): AiError {
  let message = ''
  let code = ''
  try {
    const j = JSON.parse(bodyText) as { error?: { message?: string; code?: string } }
    message = j.error?.message ?? ''
    code = j.error?.code ?? ''
  } catch {
    message = bodyText.slice(0, 200)
  }
  if (status === 401 || status === 403) return new AiError('bad-key', 'Groq did not accept this API key. Check it in the settings and try again.')
  if (status === 429) {
    const s = retrySeconds(retryAfter, message)
    return new AiError('rate', `Groq's free-tier limit was reached${s ? `. Try again in ${s} seconds` : '. Wait a moment and try again'}.`)
  }
  if (status === 404 || code === 'model_not_found' || code === 'model_decommissioned' || /does not exist or you do not have access|decommissioned/i.test(message)) return new AiError('model-gone', 'The AI model is no longer available.')
  if (status === 413) return new AiError('other', 'That was too much text for one request. Ask about fewer files or pages.')
  if (status === 400 && code === 'tool_use_failed') return new AiError('other', 'The model fumbled a tool call.', true)
  if (status >= 500) return new AiError('other', `Groq is having trouble right now (error ${status}). Try again shortly.`, true)
  return new AiError('other', message ? `Groq said: ${message.slice(0, 200)}` : `Groq returned error ${status}.`)
}

/** Asks Groq which models exist right now (cached until a request says the model is gone). */
export class ModelPicker {
  private readonly getKey: () => string | null
  private readonly fetchFn: FetchFn
  private cached: string | null = null

  constructor(getKey: () => string | null, fetchFn: FetchFn = fetch as unknown as FetchFn) {
    this.getKey = getKey
    this.fetchFn = fetchFn
  }

  get current(): string {
    return this.cached ?? FALLBACK_MODEL
  }

  invalidate(): void {
    this.cached = null
  }

  async get(): Promise<string> {
    if (this.cached) return this.cached
    const key = this.getKey()
    if (key) {
      try {
        const res = await this.fetchFn(`${BASE}/models`, { method: 'GET', headers: { Authorization: `Bearer ${key}` } })
        if (res.ok) {
          const ids = ((JSON.parse(await res.text()) as { data?: Array<{ id?: string }> }).data ?? []).map((m) => m.id ?? '').filter(Boolean)
          this.cached = pickModel(ids)
        }
      } catch {
        // offline or odd reply: fall through to the default; the chat request will report the real problem
      }
    }
    return this.cached ?? FALLBACK_MODEL
  }
}

export interface CompleteOptions {
  getKey: () => string | null
  tools: unknown[]
  fetchFn?: FetchFn
  /** Fixed model (tests). Normally the picker chooses from Groq's live list. */
  model?: string
  picker?: ModelPicker
}

export function makeComplete(o: CompleteOptions): CompleteFn {
  const fetchFn = o.fetchFn ?? (fetch as unknown as FetchFn)
  const picker = o.picker ?? new ModelPicker(o.getKey, fetchFn)

  const once = async (messages: ChatMessage[], signal: AbortSignal, model: string): Promise<Completion> => {
    const key = o.getKey()
    if (!key) throw new AiError('no-key', 'Add your Groq API key first.')
    let res
    try {
      res = await fetchFn(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, tools: o.tools, tool_choice: 'auto', temperature: 0.2, max_tokens: 4000 }),
        signal
      })
    } catch (e) {
      if (signal.aborted || (e as { name?: string }).name === 'AbortError') throw e
      throw new AiError('network', "Can't reach Groq. Check your internet connection.", true)
    }
    const text = await res.text()
    if (!res.ok) throw mapHttpError(res.status, text, res.headers.get('retry-after'))
    let msg: { content?: string | null; tool_calls?: ToolCall[] } | undefined
    try {
      msg = (JSON.parse(text) as { choices?: Array<{ message?: typeof msg }> }).choices?.[0]?.message
    } catch {
      throw new AiError('other', 'Groq sent a reply ORBIT could not read.', true)
    }
    return { content: msg?.content ?? '', toolCalls: Array.isArray(msg?.tool_calls) ? msg.tool_calls : [] }
  }

  return async (messages, signal) => {
    try {
      return await once(messages, signal, o.model ?? (await picker.get()))
    } catch (e) {
      // The model was retired or renamed: look up what exists now and try once more.
      if (e instanceof AiError && e.code === 'model-gone' && !o.model) {
        picker.invalidate()
        return await once(messages, signal, await picker.get())
      }
      throw e
    }
  }
}

/** Quick check used when saving a key, so a typo is caught immediately. */
export async function checkKey(key: string, fetchFn: FetchFn = fetch as unknown as FetchFn): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetchFn(`${BASE}/models`, { method: 'GET', headers: { Authorization: `Bearer ${key}` } })
    if (res.ok) return { ok: true, message: 'Key saved' }
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'Groq did not accept this key' }
    return { ok: false, message: `Groq returned error ${res.status}` }
  } catch {
    return { ok: false, message: "Can't reach Groq. Check your internet connection." }
  }
}
