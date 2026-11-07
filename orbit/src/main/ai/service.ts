import type { AiContext, AiEvent, AiMessage, AiStatus } from '../../shared/types.ts'
import { runAgent, type AgentEvent, type SystemInfo } from './agent.ts'
import { AiError, ModelPicker, checkKey, makeComplete } from './groq.ts'
import type { KeyStore } from './keystore.ts'
import { TOOL_DEFS, Toolbox, type ToolDeps } from './tools.ts'

const MAX_MESSAGES = 40
const MAX_CHARS = 8000
const MAX_PATHS = 50
const ABSOLUTE = /^([a-z]:[\\/]|\\\\|\/)/i

const path = (v: unknown): string | null => (typeof v === 'string' && v.length < 1024 && !v.includes('\0') && ABSOLUTE.test(v) ? v : null)

/** The renderer is a different process: nothing it sends is trusted until it has been reshaped here. */
export function sanitizeAsk(messages: unknown, context: unknown): { messages: AiMessage[]; context: AiContext } | null {
  if (!Array.isArray(messages) || messages.length === 0) return null
  const clean: AiMessage[] = []
  for (const m of messages.slice(-MAX_MESSAGES)) {
    const r = (m as { role?: unknown; content?: unknown } | null) ?? {}
    if ((r.role !== 'user' && r.role !== 'assistant') || typeof r.content !== 'string') return null
    clean.push({ role: r.role, content: r.content.slice(0, MAX_CHARS) })
  }
  if (clean[clean.length - 1]?.role !== 'user') return null
  const c = (context as Record<string, unknown> | null) ?? {}
  const pdf = c['pdf'] as { path?: unknown; page?: unknown } | null | undefined
  const pdfPath = pdf ? path(pdf.path) : null
  return {
    messages: clean,
    context: {
      cwd: path(c['cwd']),
      otherPane: path(c['otherPane']),
      selected: Array.isArray(c['selected']) ? (c['selected'] as unknown[]).map(path).filter((p): p is string => p !== null).slice(0, MAX_PATHS) : [],
      pdf: pdfPath ? { path: pdfPath, page: Math.max(1, Math.floor(Number(pdf?.page)) || 1) } : null
    }
  }
}

export interface ServiceOptions {
  keys: KeyStore
  send: (e: AiEvent) => void
  deps: () => ToolDeps
  system: () => SystemInfo
  fetchFn?: Parameters<typeof checkKey>[1]
}

export class AiService {
  private readonly o: ServiceOptions
  private readonly running = new Map<number, AbortController>()
  private readonly picker: ModelPicker

  constructor(o: ServiceOptions) {
    this.o = o
    this.picker = new ModelPicker(() => o.keys.get(), o.fetchFn as never)
  }

  async status(): Promise<AiStatus> {
    await this.o.keys.load()
    return { hasKey: this.o.keys.get() !== null, canEncrypt: this.o.keys.canEncrypt, model: this.picker.current }
  }

  async setKey(raw: unknown): Promise<{ ok: boolean; message: string }> {
    const key = typeof raw === 'string' ? raw.trim() : ''
    if (!/^gsk_[A-Za-z0-9_-]{10,}$/.test(key)) return { ok: false, message: 'That does not look like a Groq key. It starts with gsk_.' }
    const check = await checkKey(key, this.o.fetchFn)
    if (!check.ok) return check
    await this.o.keys.set(key)
    this.picker.invalidate()
    return { ok: true, message: this.o.keys.canEncrypt ? 'Key saved (encrypted on this PC)' : 'Key accepted for this session only: this PC cannot encrypt it, so it is not saved' }
  }

  async clearKey(): Promise<void> {
    for (const ac of this.running.values()) ac.abort()
    this.running.clear()
    await this.o.keys.clear()
  }

  cancel(requestId: number): void {
    this.running.get(requestId)?.abort()
    this.running.delete(requestId)
  }

  async ask(requestId: number, messages: unknown, context: unknown): Promise<void> {
    const emit = (e: AgentEvent): void => this.o.send({ requestId, ...e } as AiEvent)
    const fail = (code: AiEvent extends infer E ? (E extends { type: 'error'; code: infer C } ? C : never) : never, message: string): void => emit({ type: 'error', code, message })
    const input = sanitizeAsk(messages, context)
    if (!input) return fail('other', 'That request could not be understood.')
    await this.o.keys.load()
    if (this.o.keys.get() === null) return fail('no-key', 'Add your Groq API key first.')

    const ac = new AbortController()
    this.running.set(requestId, ac)
    try {
      await runAgent({
        messages: input.messages,
        context: input.context,
        system: this.o.system(),
        complete: makeComplete({ getKey: () => this.o.keys.get(), tools: TOOL_DEFS, picker: this.picker }),
        tools: new Toolbox(this.o.deps()),
        emit,
        signal: ac.signal
      })
    } catch (e) {
      if (ac.signal.aborted) return
      if (e instanceof AiError) fail(e.code === 'model-gone' ? 'other' : e.code, e.code === 'model-gone' ? 'Groq has no usable chat model for this key right now. Try again later, or check console.groq.com for available models.' : e.message)
      else fail('other', `Something went wrong: ${(e as Error).message}`)
    } finally {
      this.running.delete(requestId)
    }
  }
}
