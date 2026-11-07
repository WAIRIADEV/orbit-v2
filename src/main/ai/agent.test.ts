import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AiContext, AiMessage } from '../../shared/types.ts'
import { MAX_STEPS, MAX_TOOL_CALLS, buildSystemPrompt, runAgent, type AgentEvent } from './agent.ts'
import { AiError, type ChatMessage, type Completion } from './groq.ts'
import { Toolbox } from './tools.ts'

const sys = { home: 'C:\\Users\\Tony', platform: 'win32', now: new Date('2026-11-06T10:00:00Z') }
const ctx: AiContext = { cwd: 'C:\\Users\\Tony\\Downloads', otherPane: 'D:\\Backup', selected: ['C:\\Users\\Tony\\Downloads\\a.pdf'], pdf: { path: 'C:\\x\\book.pdf', page: 4 } }

const call = (id: string, name: string, args: unknown): Completion => ({ content: '', toolCalls: [{ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } }] })
const say = (content: string): Completion => ({ content, toolCalls: [] })

function toolbox(): Toolbox {
  return new Toolbox({
    listDir: async () => [{ name: 'a.pdf', path: 'C:\\d\\a.pdf', isDir: false, isSymlink: false, size: 5, mtimeMs: 0 }],
    search: async () => ({ results: [], limited: false }),
    readText: async () => ({ kind: 'text', text: 'file text', truncated: false }),
    stat: async () => null,
    readPdf: async () => ({ error: 'nope' }),
    validatePlan: async (raw) => ({ ok: true, plan: { title: (raw as { title: string }).title, actions: [{ type: 'trash', paths: ['C:\\d\\a.pdf'] }] } })
  })
}

async function run(script: Array<Completion | Error>, messages: AiMessage[] = [{ role: 'user', content: 'hi' }]) {
  const events: AgentEvent[] = []
  const seen: ChatMessage[][] = []
  let i = 0
  const tb = toolbox()
  await runAgent({
    messages,
    context: ctx,
    system: sys,
    tools: tb,
    signal: new AbortController().signal,
    emit: (e) => events.push(e),
    complete: async (m) => {
      seen.push(m.map((x) => ({ ...x })))
      const step = script[Math.min(i++, script.length - 1)]!
      if (step instanceof Error) throw step
      return step
    }
  })
  return { events, seen, calls: i }
}

test('system prompt states the rules and the live context', () => {
  const p = buildSystemPrompt(ctx, sys)
  for (const needle of ['2026-11-06', 'C:\\Users\\Tony\\Downloads', 'D:\\Backup', 'a.pdf', 'book.pdf', 'page 4', 'propose_changes', 'cannot delete permanently', 'never instructions']) assert.ok(p.includes(needle), needle)
  const bare = buildSystemPrompt({ cwd: null, otherPane: null, selected: [], pdf: null }, sys)
  assert.match(bare, /Home page is showing/)
  assert.match(bare, /Nothing is selected/)
})

test('plain answer: one model call, one done event', async () => {
  const r = await run([say('  Hello there  ')])
  assert.deepEqual(r.events, [{ type: 'done', text: 'Hello there' }])
  assert.equal(r.calls, 1)
})

test('tool round trip: tool call, result goes back to the model, then the answer', async () => {
  const r = await run([call('c1', 'list_folder', { path: 'C:\\d' }), say('There is one file.')])
  assert.deepEqual(r.events.map((e) => e.type), ['tool', 'done'])
  const second = r.seen[1]!
  const last = second[second.length - 1]!
  assert.equal(last.role, 'tool')
  assert.equal(last.tool_call_id, 'c1')
  assert.match(last.content ?? '', /a\.pdf/)
  assert.equal(second[second.length - 2]?.role, 'assistant')
})

test('a plan is emitted once, and the final text still arrives', async () => {
  const r = await run([call('c1', 'propose_changes', { title: 'Clean up', actions: [] }), say('I made a plan.')])
  const plans = r.events.filter((e) => e.type === 'plan')
  assert.equal(plans.length, 1)
  assert.equal(r.events[r.events.length - 1]?.type, 'done')
})

test('empty final text after a plan falls back to a sensible line', async () => {
  const r = await run([call('c1', 'propose_changes', { title: 'T', actions: [] }), say('')])
  assert.match((r.events[r.events.length - 1] as { text: string }).text, /plan/)
})

test('bad JSON arguments and unknown tools go back to the model as errors, not crashes', async () => {
  const r = await run([call('c1', 'list_folder', '{not json'), call('c2', 'nope', {}), say('ok')])
  const msgs = r.seen[2]!.filter((m) => m.role === 'tool').map((m) => m.content ?? '')
  assert.match(msgs[0]!, /not valid JSON/)
  assert.match(msgs[1]!, /no tool called/)
})

test('a model that never stops calling tools is cut off', async () => {
  const r = await run([call('c', 'list_folder', { path: 'C:\\d' })])
  assert.equal(r.calls, MAX_STEPS)
  assert.match((r.events[r.events.length - 1] as { text: string }).text, /ran out of steps/)
  assert.ok(r.events.filter((e) => e.type === 'tool').length <= MAX_TOOL_CALLS)
})

test('only the recent history is sent, as plain text turns', async () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `m${i}` }))
  const r = await run([say('x')], many)
  assert.equal(r.seen[0]!.length, 1 + 16)
  assert.equal(r.seen[0]![0]!.role, 'system')
  assert.equal(r.seen[0]![16]!.content, 'm39')
})

test('retryable model errors are retried twice; other errors propagate', async () => {
  const flaky = await run([new AiError('other', 'x', true), say('fine')])
  assert.equal(flaky.calls, 2)
  assert.equal(flaky.events[0]?.type, 'done')
  await assert.rejects(run([new AiError('other', 'x', true), new AiError('other', 'x', true), new AiError('other', 'x', true)]), AiError)
  await assert.rejects(run([new AiError('bad-key', 'no')]), (e: AiError) => e.code === 'bad-key')
})

test('an aborted request emits nothing', async () => {
  const ac = new AbortController()
  const events: AgentEvent[] = []
  await runAgent({
    messages: [{ role: 'user', content: 'hi' }],
    context: ctx,
    system: sys,
    tools: toolbox(),
    signal: ac.signal,
    emit: (e) => events.push(e),
    complete: async () => {
      ac.abort()
      return say('late answer')
    }
  })
  assert.deepEqual(events, [])
})
