import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AiError, checkKey, makeComplete, mapHttpError, retrySeconds } from './groq.ts'

const resp = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
})

test('retrySeconds reads the header, then Groq wording', () => {
  assert.equal(retrySeconds('7', ''), 7)
  assert.equal(retrySeconds(null, 'Rate limit reached. Please try again in 3.5s.'), 4)
  assert.equal(retrySeconds(null, 'Please try again in 2m10.5s'), 131)
  assert.equal(retrySeconds(null, 'nothing useful'), null)
})

test('mapHttpError gives each failure a plain, correct code', () => {
  assert.equal(mapHttpError(401, '{}', null).code, 'bad-key')
  assert.equal(mapHttpError(403, '{}', null).code, 'bad-key')
  const rate = mapHttpError(429, '{"error":{"message":"Please try again in 12s"}}', null)
  assert.equal(rate.code, 'rate')
  assert.match(rate.message, /12 seconds/)
  assert.match(mapHttpError(413, '{}', null).message, /too much text/)
  assert.ok(mapHttpError(400, '{"error":{"code":"tool_use_failed","message":"x"}}', null).retryable)
  assert.ok(mapHttpError(503, 'down', null).retryable)
  assert.match(mapHttpError(400, '{"error":{"message":"bad model"}}', null).message, /bad model/)
})

test('makeComplete sends the key and tools, and parses text and tool calls', async () => {
  let seen: { url: string; auth: string; body: Record<string, unknown> } | null = null
  const complete = makeComplete({
    getKey: () => 'gsk_test',
    tools: [{ type: 'function' }],
    fetchFn: async (url, init) => {
      seen = { url, auth: init.headers['Authorization'] ?? '', body: JSON.parse(init.body ?? '{}') }
      return resp(200, { choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_folder', arguments: '{"path":"C:\\\\a"}' } }] } }] })
    }
  })
  const out = await complete([{ role: 'user', content: 'hi' }], new AbortController().signal)
  assert.equal(out.toolCalls[0]?.function.name, 'list_folder')
  assert.equal(out.content, '')
  assert.equal(seen!.auth, 'Bearer gsk_test')
  assert.match(seen!.url, /api\.groq\.com\/openai\/v1\/chat\/completions$/)
  assert.equal(seen!.body['tool_choice'], 'auto')
  assert.equal((seen!.body['tools'] as unknown[]).length, 1)
})

test('makeComplete: no key, bad key, rate limit, network down, abort', async () => {
  const sig = new AbortController().signal
  const msgs = [{ role: 'user' as const, content: 'x' }]
  await assert.rejects(makeComplete({ getKey: () => null, tools: [] })(msgs, sig), (e: AiError) => e.code === 'no-key')
  await assert.rejects(makeComplete({ getKey: () => 'k', tools: [], fetchFn: async () => resp(401, {}) })(msgs, sig), (e: AiError) => e.code === 'bad-key')
  await assert.rejects(makeComplete({ getKey: () => 'k', tools: [], fetchFn: async () => resp(429, {}, { 'retry-after': '9' }) })(msgs, sig), (e: AiError) => e.code === 'rate' && /9 seconds/.test(e.message))
  await assert.rejects(makeComplete({ getKey: () => 'k', tools: [], fetchFn: async () => { throw new TypeError('fetch failed') } })(msgs, sig), (e: AiError) => e.code === 'network')
  const ac = new AbortController()
  ac.abort()
  await assert.rejects(makeComplete({ getKey: () => 'k', tools: [], fetchFn: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }) } })(msgs, ac.signal), (e: Error) => e.name === 'AbortError')
  const plain = await makeComplete({ getKey: () => 'k', tools: [], fetchFn: async () => resp(200, { choices: [{ message: { content: 'Hello' } }] }) })(msgs, sig)
  assert.deepEqual(plain, { content: 'Hello', toolCalls: [] })
  await assert.rejects(makeComplete({ getKey: () => 'k', tools: [], fetchFn: async () => resp(200, 'not json') })(msgs, sig), (e: AiError) => e.retryable)
})

test('checkKey: accepted, rejected, offline', async () => {
  assert.deepEqual(await checkKey('k', async () => resp(200, {})), { ok: true, message: 'Key saved' })
  assert.equal((await checkKey('k', async () => resp(401, {}))).ok, false)
  assert.match((await checkKey('k', async () => { throw new Error('x') })).message, /internet/)
})

import { ModelPicker, pickModel } from './groq.ts'

test('pickModel prefers current tool-capable models and never picks speech/guard models', () => {
  assert.equal(pickModel(['whisper-large-v3', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b']), 'openai/gpt-oss-120b')
  assert.equal(pickModel(['llama-3.3-70b-versatile', 'qwen/qwen3.8-27b']), 'qwen/qwen3.8-27b')
  assert.equal(pickModel(['openai/gpt-oss-safeguard-20b', 'whisper-large-v3-turbo', 'playai-tts']), null)
  assert.equal(pickModel(['some/new-qwen-model', 'llama-guard-9']), 'some/new-qwen-model') // unknown names still match by family
  assert.equal(pickModel([]), null)
})

test('ModelPicker reads the live list once, caches it, and refreshes after invalidate', async () => {
  let calls = 0
  let ids = ['openai/gpt-oss-120b']
  const picker = new ModelPicker(() => 'k', async () => {
    calls++
    return resp(200, { data: ids.map((id) => ({ id })) })
  })
  assert.equal(await picker.get(), 'openai/gpt-oss-120b')
  assert.equal(await picker.get(), 'openai/gpt-oss-120b')
  assert.equal(calls, 1)
  ids = ['qwen/qwen3.8-27b']
  picker.invalidate()
  assert.equal(await picker.get(), 'qwen/qwen3.8-27b')
  assert.equal(picker.current, 'qwen/qwen3.8-27b')
  const offline = new ModelPicker(() => 'k', async () => { throw new Error('x') })
  assert.equal(await offline.get(), 'openai/gpt-oss-120b') // falls back instead of failing
  assert.equal(await new ModelPicker(() => null, async () => resp(200, {})).get(), 'openai/gpt-oss-120b')
})

test('a retired model triggers one lookup of what exists now, then a retry with the new one', async () => {
  const used: string[] = []
  let listed = ['llama-3.3-70b-versatile']
  const complete = makeComplete({
    getKey: () => 'k',
    tools: [],
    fetchFn: async (url, init) => {
      if (url.endsWith('/models')) return resp(200, { data: listed.map((id) => ({ id })) })
      const model = (JSON.parse(init.body ?? '{}') as { model: string }).model
      used.push(model)
      if (model === 'llama-3.3-70b-versatile') {
        listed = ['openai/gpt-oss-120b']
        return resp(404, { error: { message: 'The model `llama-3.3-70b-versatile` does not exist or you do not have access to it.', code: 'model_not_found' } })
      }
      return resp(200, { choices: [{ message: { content: 'hi' } }] })
    }
  })
  const out = await complete([{ role: 'user', content: 'x' }], new AbortController().signal)
  assert.equal(out.content, 'hi')
  assert.deepEqual(used, ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'])
})

test('mapHttpError recognises a missing or retired model in several wordings', () => {
  assert.equal(mapHttpError(404, '{"error":{"code":"model_not_found","message":"x"}}', null).code, 'model-gone')
  assert.equal(mapHttpError(400, '{"error":{"code":"model_decommissioned","message":"x"}}', null).code, 'model-gone')
  assert.equal(mapHttpError(400, '{"error":{"message":"The model `x` does not exist or you do not have access to it."}}', null).code, 'model-gone')
})
