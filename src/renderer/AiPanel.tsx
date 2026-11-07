import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiContext, AiPlan, AiStatus } from '@shared/types'
import { describeAction } from '../shared/aiPlan.ts'
import { Icon } from './Icons'
import { contextLabel, historyFor, inlineParts, suggestions, type ChatTurn } from './aiText'

interface Turn extends ChatTurn {
  id: number
  steps: string[]
  plan?: { plan: AiPlan; state: 'pending' | 'applied' | 'dismissed' }
  error?: { code: string; message: string }
}

interface Props {
  /** Read at send time, so it always reflects what is on screen right now. */
  getContext: () => AiContext
  /** Same information, for the label above the input (changes as you browse). */
  contextNow: AiContext
  onClose: () => void
  onApply: (plan: AiPlan) => void
}

function Rich({ text }: { text: string }): JSX.Element {
  return (
    <>
      {inlineParts(text).map((p, i) =>
        p.kind === 'code' ? (
          <code key={i}>{p.text}</code>
        ) : p.kind === 'bold' ? (
          <strong key={i}>{p.text}</strong>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </>
  )
}

export default function AiPanel({ getContext, contextNow, onClose, onApply }: Props): JSX.Element {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [keyText, setKeyText] = useState('')
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [keyBusy, setKeyBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const nextId = useRef(1)
  const reqId = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const turnsRef = useRef(turns)
  turnsRef.current = turns

  const refreshStatus = useCallback(() => void window.orbit.aiStatus().then(setStatus), [])
  useEffect(refreshStatus, [refreshStatus])

  // Always scroll to the newest thing.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns, busy])

  useEffect(() => {
    if (status?.hasKey) inputRef.current?.focus()
  }, [status?.hasKey])

  const patch = useCallback((id: number, f: (t: Turn) => Turn) => setTurns((ts) => ts.map((t) => (t.id === id ? f(t) : t))), [])

  // Events from the main process for the current request.
  const answerId = useRef(0)
  useEffect(() => {
    return window.orbit.onAiEvent((e) => {
      if (e.requestId !== reqId.current) return // an old or cancelled request
      const id = answerId.current
      if (e.type === 'tool') patch(id, (t) => ({ ...t, steps: [...t.steps, e.label] }))
      else if (e.type === 'plan') patch(id, (t) => ({ ...t, plan: { plan: e.plan, state: 'pending' } }))
      else if (e.type === 'done') {
        patch(id, (t) => ({ ...t, text: e.text }))
        setBusy(false)
      } else {
        patch(id, (t) => ({ ...t, failed: true, error: { code: e.code, message: e.message } }))
        setBusy(false)
        if (e.code === 'no-key' || e.code === 'bad-key') refreshStatus()
      }
    })
  }, [patch, refreshStatus])

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim()
      if (!text || busy || !status?.hasKey) return
      const user: Turn = { id: nextId.current++, role: 'user', text, steps: [] }
      const answer: Turn = { id: nextId.current++, role: 'assistant', text: '', steps: [] }
      answerId.current = answer.id
      const history = historyFor([...turnsRef.current, user])
      setTurns((ts) => [...ts, user, answer])
      setInput('')
      setBusy(true)
      reqId.current += 1
      window.orbit.aiAsk(reqId.current, history, getContext())
    },
    [busy, status?.hasKey, getContext]
  )

  const stop = (): void => {
    window.orbit.aiCancel(reqId.current)
    reqId.current += 1 // anything still in flight is ignored
    patch(answerId.current, (t) => ({ ...t, failed: true, error: { code: 'stopped', message: 'Stopped.' } }))
    setBusy(false)
  }

  const saveKey = async (): Promise<void> => {
    setKeyBusy(true)
    setKeyMsg(null)
    const r = await window.orbit.aiSetKey(keyText)
    setKeyBusy(false)
    setKeyMsg({ ok: r.ok, text: r.message })
    if (r.ok) {
      setKeyText('')
      refreshStatus()
    }
  }

  const removeKey = async (): Promise<void> => {
    if (!confirmRemove) {
      setConfirmRemove(true)
      window.setTimeout(() => setConfirmRemove(false), 4000)
      return
    }
    setConfirmRemove(false)
    await window.orbit.aiClearKey()
    setTurns([])
    setBusy(false)
    setKeyMsg(null)
    refreshStatus()
  }

  const setPlanState = (id: number, state: 'applied' | 'dismissed'): void => patch(id, (t) => (t.plan ? { ...t, plan: { ...t.plan, state } } : t))

  const ctxLabel = contextLabel(contextNow)
  const hasKey = status?.hasKey === true

  return (
    <aside className="aipanel" aria-label="Copilot">
      <header className="ai-head">
        <Icon name="sparkle" size={16} />
        <h3>Copilot</h3>
        <span className="grow" />
        {turns.length > 0 && (
          <button className="iconbtn small" title="New chat" onClick={() => (busy ? undefined : setTurns([]))} disabled={busy}>
            <Icon name="plus" size={15} />
          </button>
        )}
        {hasKey && (
          <button className={`ai-key${confirmRemove ? ' danger' : ''}`} onClick={() => void removeKey()} title="Forget the saved Groq key">
            {confirmRemove ? 'Click again to remove key' : 'Remove key'}
          </button>
        )}
        <button className="iconbtn small" onClick={onClose} title="Close (Ctrl+J)">
          <Icon name="close" size={16} />
        </button>
      </header>

      {status === null && <div className="ai-empty">Loading…</div>}

      {status !== null && !hasKey && (
        <div className="ai-setup">
          <p>
            <strong>Connect Groq</strong> to use the copilot. It reads your folders and PDFs when you ask, and proposes changes you approve with one click.
          </p>
          <ol>
            <li>
              Get a free key at <code>console.groq.com/keys</code>
            </li>
            <li>Paste it here. It starts with <code>gsk_</code></li>
          </ol>
          <input
            type="password"
            className="ai-keyinput"
            value={keyText}
            placeholder="gsk_…"
            aria-label="Groq API key"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setKeyText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveKey()
            }}
          />
          <button className="ql-open" disabled={keyBusy || keyText.trim().length === 0} onClick={() => void saveKey()}>
            {keyBusy ? 'Checking…' : 'Save key'}
          </button>
          {keyMsg && <p className={keyMsg.ok ? 'ai-ok' : 'ai-bad'}>{keyMsg.text}</p>}
          <p className="ai-fine">
            {status.canEncrypt ? 'The key is stored encrypted on this PC and only ever used by ORBIT itself.' : 'This PC cannot encrypt the key, so it is kept only until ORBIT closes.'} Files are sent to Groq only when the copilot reads them to answer you.
          </p>
        </div>
      )}

      {hasKey && (
        <>
          <div className="ai-list" ref={listRef} aria-live="polite">
            {turns.length === 0 && (
              <div className="ai-empty">
                <p>Ask about what you are looking at, or tell me what to tidy up.</p>
                <div className="ai-chips">
                  {suggestions(contextNow).map((s) => (
                    <button key={s} className="ai-chip" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((t) => (
              <div key={t.id} className={`ai-turn ${t.role}${t.failed ? ' failed' : ''}`}>
                {t.role === 'assistant' && t.steps.length > 0 && (
                  <ul className="ai-steps">
                    {t.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                )}
                {t.text && (
                  <div className="ai-bubble">
                    <Rich text={t.text} />
                  </div>
                )}
                {t.role === 'assistant' && !t.text && !t.error && busy && t.id === answerId.current && <div className="ai-bubble ai-think">Thinking…</div>}
                {t.plan && (
                  <div className={`ai-plan ${t.plan.state}`}>
                    <div className="ai-plan-title">{t.plan.plan.title}</div>
                    <ul>
                      {t.plan.plan.actions.map((a, i) => (
                        <li key={i}>{describeAction(a)}</li>
                      ))}
                    </ul>
                    {t.plan.state === 'pending' && (
                      <div className="ai-plan-btns">
                        <button
                          className="ql-open"
                          onClick={() => {
                            onApply(t.plan!.plan)
                            setPlanState(t.id, 'applied')
                          }}
                        >
                          Apply
                        </button>
                        <button className="ai-ghost" onClick={() => setPlanState(t.id, 'dismissed')}>
                          Dismiss
                        </button>
                      </div>
                    )}
                    {t.plan.state === 'applied' && <div className="ai-plan-note">Applied. Ctrl+Z undoes it one step at a time.</div>}
                    {t.plan.state === 'dismissed' && <div className="ai-plan-note">Dismissed. Nothing was changed.</div>}
                  </div>
                )}
                {t.error && <div className={`ai-error${t.error.code === 'stopped' ? ' soft' : ''}`}>{t.error.message}</div>}
              </div>
            ))}
          </div>

          <div className="ai-compose">
            <div className="ai-ctx" title="What the copilot can see right now">
              <Icon name="eye" size={12} />
              <span>{ctxLabel}</span>
            </div>
            <div className="ai-row">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                placeholder="Ask or tell the copilot…"
                aria-label="Message the copilot"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send(input)
                  } else if (e.key === 'Escape') {
                    e.currentTarget.blur()
                  }
                }}
              />
              {busy ? (
                <button className="ai-send stop" onClick={stop} title="Stop">
                  <span className="ai-stopsq" />
                </button>
              ) : (
                <button className="ai-send" onClick={() => send(input)} disabled={input.trim().length === 0} title="Send (Enter)">
                  <Icon name="up" size={16} />
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </aside>
  )
}
