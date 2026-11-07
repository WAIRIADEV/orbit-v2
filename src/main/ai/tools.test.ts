import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { FileEntry } from '../../shared/types.ts'
import { isSecretPath, READ_CHARS, Toolbox, TOOL_DEFS, type ToolDeps } from './tools.ts'

const E = (name: string, isDir = false, size = 10): FileEntry => ({ name, path: `C:\\d\\${name}`, isDir, isSymlink: false, size, mtimeMs: Date.UTC(2026, 9, 1) })

function box(over: Partial<ToolDeps> = {}): Toolbox {
  return new Toolbox({
    listDir: async () => [E('b.txt'), E('Zed', true), E('a.txt', false, 2048)],
    search: async () => ({ results: [E('invoice.pdf')], limited: false }),
    readText: async () => ({ kind: 'text', text: 'hello', truncated: false }),
    stat: async (p) => (p.endsWith('ghost') ? null : E('x.txt')),
    readPdf: async () => ({ pages: 9, from: 1, to: 3, text: '--- page 1 ---\nhi\n', truncated: false }),
    validatePlan: async (raw) => ({ ok: true, plan: { title: String((raw as { title: string }).title), actions: [{ type: 'trash', paths: ['C:\\d\\a.txt'] }] } }),
    ...over
  })
}

test('isSecretPath blocks keys, tokens and password stores but not normal files', () => {
  for (const p of ['C:\\Users\\T\\.ssh\\id_rsa', 'C:\\p\\.env', 'C:\\p\\.env.local', 'C:\\x\\cert.PEM', 'C:\\x\\wallet.kdbx', 'C:\\U\\.aws\\credentials', 'C:\\x\\Login Data', '/home/t/.npmrc', 'C:\\x\\id_ed25519.pub']) {
    assert.ok(isSecretPath(p), p)
  }
  for (const p of ['C:\\Docs\\notes.txt', 'C:\\Docs\\environment.md', 'C:\\Docs\\keyboard.txt', 'C:\\Docs\\monkey.png']) assert.ok(!isSecretPath(p), p)
})

test('every tool is declared with a name and parameters', () => {
  const names = TOOL_DEFS.map((t) => (t as { function: { name: string } }).function.name)
  assert.deepEqual(names, ['list_folder', 'search_files', 'read_text_file', 'read_pdf', 'file_info', 'propose_changes'])
})

test('list_folder: folders first, sizes, label, and a cap on huge folders', async () => {
  const r = await box().run('list_folder', { path: 'C:\\d' })
  assert.match(r.text, /3 items/)
  assert.ok(r.text.indexOf('[folder] Zed') < r.text.indexOf('a.txt'))
  assert.match(r.text, /a\.txt \| 2 KB \| 2026-10-01/)
  assert.equal(r.label, 'Looked in d')
  const many = Array.from({ length: 400 }, (_, i) => E(`f${i}.txt`))
  const big = await box({ listDir: async () => many }).run('list_folder', { path: 'C:\\d' })
  assert.match(big.text, /400 items/)
  assert.match(big.text, /and 250 more/)
})

test('tools refuse relative paths and unknown tools without throwing', async () => {
  const b = box()
  assert.match((await b.run('list_folder', { path: 'Documents' })).text, /absolute/)
  assert.match((await b.run('read_text_file', {})).text, /absolute/)
  assert.match((await b.run('rm_rf', {})).text, /no tool called/)
  const bad = await box({ listDir: async () => { throw new Error('boom') } }).run('list_folder', { path: 'C:\\d' })
  assert.match(bad.text, /boom/)
})

test('read_text_file: trims long files, refuses secrets, explains binary and errors', async () => {
  const long = await box({ readText: async () => ({ kind: 'text', text: 'x'.repeat(READ_CHARS + 500), truncated: true }) }).run('read_text_file', { path: 'C:\\d\\a.txt' })
  assert.ok(long.text.length < READ_CHARS + 60)
  assert.match(long.text, /continues/)
  let called = false
  const secret = await box({ readText: async () => { called = true; return { kind: 'text', text: 'k', truncated: false } } }).run('read_text_file', { path: 'C:\\Users\\T\\.env' })
  assert.ok(!called)
  assert.match(secret.text, /key or password/)
  assert.match(secret.label, /private/)
  assert.match((await box({ readText: async () => ({ kind: 'binary' }) }).run('read_text_file', { path: 'C:\\d\\a.bin' })).text, /binary/)
  assert.match((await box({ readText: async () => ({ kind: 'error', message: 'EACCES' }) }).run('read_text_file', { path: 'C:\\d\\a.txt' })).text, /EACCES/)
})

test('read_pdf: range label, page count hint, defaults', async () => {
  let args: number[] = []
  const b = box({ readPdf: async (_p, f, t) => { args = [f, t]; return { pages: 9, from: 1, to: 3, text: 'T', truncated: false } } })
  const r = await b.run('read_pdf', { path: 'C:\\d\\doc.pdf' })
  assert.deepEqual(args, [1, 3])
  assert.equal(r.label, 'Read doc.pdf, pages 1–3')
  assert.match(r.text, /9 pages/)
  assert.match(r.text, /again for more/)
  await b.run('read_pdf', { path: 'C:\\d\\doc.pdf', from_page: 5 })
  assert.deepEqual(args, [5, 7])
  assert.match((await box({ readPdf: async () => ({ error: 'password protected' }) }).run('read_pdf', { path: 'C:\\d\\a.pdf' })).text, /password/)
})

test('search_files and file_info', async () => {
  const s = await box().run('search_files', { root: 'C:\\d', query: 'invoice' })
  assert.match(s.text, /C:\\d\\invoice\.pdf/)
  assert.match((await box({ search: async () => ({ results: [], limited: false }) }).run('search_files', { root: 'C:\\d', query: 'zzz' })).text, /No file/)
  assert.match((await box().run('search_files', { root: 'C:\\d', query: '  ' })).text, /required/)
  assert.match((await box().run('file_info', { path: 'C:\\d\\ghost' })).text, /does not exist/)
  assert.match((await box().run('file_info', { path: 'C:\\d\\x.txt' })).text, /File C:\\d\\x\.txt/)
})

test('propose_changes: a valid plan is recorded; a rejected one tells the model why and records nothing', async () => {
  const good = box()
  const r = await good.run('propose_changes', { title: 'Tidy', actions: [] })
  assert.equal(good.plan?.title, 'Tidy')
  assert.match(r.text, /shown to the person/)
  const bad = box({ validatePlan: async () => ({ ok: false, error: 'Action 1: "x" does not exist.' }) })
  const r2 = await bad.run('propose_changes', {})
  assert.equal(bad.plan, null)
  assert.match(r2.text, /rejected.*does not exist.*again/)
})
