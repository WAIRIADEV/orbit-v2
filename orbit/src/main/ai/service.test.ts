import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AiEvent } from '../../shared/types.ts'
import { KeyStore } from './keystore.ts'
import { realToolDeps } from './realDeps.ts'
import { AiService, sanitizeAsk } from './service.ts'

test('sanitizeAsk reshapes untrusted input and rejects nonsense', () => {
  assert.equal(sanitizeAsk(null, {}), null)
  assert.equal(sanitizeAsk([], {}), null)
  assert.equal(sanitizeAsk([{ role: 'system', content: 'x' }], {}), null) // the renderer may not inject a system turn
  assert.equal(sanitizeAsk([{ role: 'user', content: 5 }], {}), null)
  assert.equal(sanitizeAsk([{ role: 'assistant', content: 'last must be user' }], {}), null)
  const r = sanitizeAsk(
    [{ role: 'user', content: 'x'.repeat(20000) }],
    { cwd: 'C:\\a', otherPane: 'relative', selected: ['C:\\a\\1', 'nope', 7, 'C:\\a\\2'], pdf: { path: 'C:\\a\\b.pdf', page: 3.7 }, evil: 'x' }
  )
  assert.ok(r)
  assert.equal(r.messages[0]?.content.length, 8000)
  assert.deepEqual(r.context, { cwd: 'C:\\a', otherPane: null, selected: ['C:\\a\\1', 'C:\\a\\2'], pdf: { path: 'C:\\a\\b.pdf', page: 3 } })
  const none = sanitizeAsk([{ role: 'user', content: 'hi' }], undefined)
  assert.deepEqual(none?.context, { cwd: null, otherPane: null, selected: [], pdf: null })
})

const memKeys = (): KeyStore => new KeyStore('unused', { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' })
const ok = (status = 200, body: unknown = {}) => async () => ({ ok: status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(body) })

test('service: key format check, server check, status, clear', async () => {
  const events: AiEvent[] = []
  const svc = new AiService({ keys: memKeys(), send: (e) => events.push(e), deps: realToolDeps, system: () => ({ home: 'C:\\', platform: 'win32', now: new Date() }), fetchFn: ok(200) })
  assert.deepEqual(await svc.status(), { hasKey: false, canEncrypt: false, model: 'openai/gpt-oss-120b' })
  assert.equal((await svc.setKey('hello')).ok, false)
  assert.equal((await svc.setKey(undefined)).ok, false)
  const rejected = new AiService({ keys: memKeys(), send: () => {}, deps: realToolDeps, system: () => ({ home: '', platform: '', now: new Date() }), fetchFn: ok(401) })
  assert.equal((await rejected.setKey('gsk_abcdefghijklmnop')).ok, false)
  assert.equal((await rejected.status()).hasKey, false)
  const good = await svc.setKey('gsk_abcdefghijklmnop')
  assert.ok(good.ok && /this session only/.test(good.message))
  assert.equal((await svc.status()).hasKey, true)
  await svc.clearKey()
  assert.equal((await svc.status()).hasKey, false)
})

test('service.ask: no key and malformed input become error events, not exceptions', async () => {
  const events: AiEvent[] = []
  const svc = new AiService({ keys: memKeys(), send: (e) => events.push(e), deps: realToolDeps, system: () => ({ home: '', platform: '', now: new Date() }) })
  await svc.ask(1, [{ role: 'user', content: 'hi' }], {})
  assert.deepEqual(events[0], { requestId: 1, type: 'error', code: 'no-key', message: 'Add your Groq API key first.' })
  await svc.ask(2, 'garbage', {})
  assert.equal((events[1] as { code: string }).code, 'other')
  svc.cancel(99) // cancelling something that is not running is harmless
})

test('real tool deps: list, search, stat and read on a real folder; errors are readable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbit-aitools-'))
  try {
    await mkdir(join(dir, 'sub'))
    await writeFile(join(dir, 'invoice march.txt'), 'total 100')
    await writeFile(join(dir, 'sub', 'notes.txt'), 'x')
    const d = realToolDeps()
    const l = await d.listDir(dir)
    assert.ok(Array.isArray(l) && l.length === 2)
    assert.match(String((await d.listDir(join(dir, 'ghost')) as { error: string }).error), /does not exist/)
    assert.match(String((await d.listDir(join(dir, 'invoice march.txt')) as { error: string }).error), /is a file/)
    const s = await d.search(dir, 'invoice', 10)
    assert.ok(!('error' in s) && s.results.length === 1 && s.results[0]?.name === 'invoice march.txt')
    assert.equal((await d.stat(join(dir, 'sub')))?.isDir, true)
    assert.equal(await d.stat(join(dir, 'nope')), null)
    const t = await d.readText(join(dir, 'invoice march.txt'))
    assert.deepEqual(t, { kind: 'text', text: 'total 100', truncated: false })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
