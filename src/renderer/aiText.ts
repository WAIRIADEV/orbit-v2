// Small pure helpers for the AI panel (unit-tested).
import type { AiContext, AiMessage } from '@shared/types'
import { baseName } from '../shared/paths.ts'

export interface Part {
  kind: 'text' | 'code' | 'bold'
  text: string
}

/** Splits a reply into plain text, `code` and **bold** pieces. Nothing is ever treated as HTML. */
export function inlineParts(input: string): Part[] {
  const out: Part[] = []
  const re = /`([^`\n]+)`|\*\*([^*\n]+)\*\*/g
  let last = 0
  for (let m = re.exec(input); m; m = re.exec(input)) {
    if (m.index > last) out.push({ kind: 'text', text: input.slice(last, m.index) })
    if (m[1] !== undefined) out.push({ kind: 'code', text: m[1] })
    else out.push({ kind: 'bold', text: m[2] ?? '' })
    last = m.index + m[0].length
  }
  if (last < input.length) out.push({ kind: 'text', text: input.slice(last) })
  return out
}

/** What the person sees as "the AI can see this": a short line above the input. */
export function contextLabel(c: AiContext): string {
  const bits: string[] = []
  bits.push(c.cwd ? baseName(c.cwd) || c.cwd : 'Home')
  const sameAsPdf = c.selected.length === 1 && c.pdf !== null && c.selected[0]?.toLowerCase() === c.pdf.path.toLowerCase()
  if (sameAsPdf) {
    // the open PDF is also the selected file: say it once
  } else if (c.selected.length === 1) bits.push(baseName(c.selected[0] ?? ''))
  else if (c.selected.length > 1) bits.push(`${c.selected.length} selected`)
  if (c.pdf) bits.push(`${baseName(c.pdf.path)} p.${c.pdf.page}`)
  return bits.join(' · ')
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
  /** Failed or cancelled turns are shown but never sent back to the model. */
  failed?: boolean
}

/** The turns that go to the model: plain text only, no errors, no empty replies. */
export function historyFor(turns: ChatTurn[]): AiMessage[] {
  const out: AiMessage[] = []
  for (const t of turns) {
    if (t.failed || !t.text.trim()) continue
    out.push({ role: t.role, content: t.text })
  }
  // The model must see an alternating-enough history ending with the person's last message.
  while (out.length > 0 && out[out.length - 1]?.role !== 'user') out.pop()
  return out
}

/** Starter questions that fit what is on screen. */
export function suggestions(c: AiContext): string[] {
  const s: string[] = []
  if (c.pdf) s.push('Summarise this PDF', `What is on page ${c.pdf.page}?`)
  if (c.selected.length === 1) s.push(`What is ${baseName(c.selected[0] ?? '')}?`)
  if (c.cwd) s.push("What's in this folder?", 'Suggest how to organise this folder')
  else s.push('What can you help me with?')
  return s.slice(0, 3)
}
