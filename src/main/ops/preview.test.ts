import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readTextPreview } from './preview.ts'

async function tmp() {
  return mkdtemp(join(tmpdir(), 'orbit-prev-'))
}

test('small text file is returned whole', async () => {
  const dir = await tmp()
  await writeFile(join(dir, 'a.txt'), 'hello\nworld')
  assert.deepEqual(await readTextPreview(join(dir, 'a.txt')), { kind: 'text', text: 'hello\nworld', truncated: false })
})

test('large file is cut at the byte limit and flagged', async () => {
  const dir = await tmp()
  await writeFile(join(dir, 'big.log'), 'x'.repeat(10_000))
  const r = await readTextPreview(join(dir, 'big.log'), 1000)
  assert.equal(r.kind, 'text')
  if (r.kind === 'text') {
    assert.equal(r.text.length, 1000)
    assert.equal(r.truncated, true)
  }
})

test('a multi-byte character split by the limit does not leave garbage', async () => {
  const dir = await tmp()
  await writeFile(join(dir, 'u.txt'), 'ab' + '日'.repeat(20)) // 2 + 60 bytes
  const r = await readTextPreview(join(dir, 'u.txt'), 4) // cuts inside the first 日
  assert.equal(r.kind, 'text')
  if (r.kind === 'text') assert.equal(r.text, 'ab')
})

test('binary content is detected', async () => {
  const dir = await tmp()
  await writeFile(join(dir, 'x.bin'), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x01]))
  assert.deepEqual(await readTextPreview(join(dir, 'x.bin')), { kind: 'binary' })
})

test('empty files and missing files are handled', async () => {
  const dir = await tmp()
  await writeFile(join(dir, 'empty.txt'), '')
  assert.deepEqual(await readTextPreview(join(dir, 'empty.txt')), { kind: 'text', text: '', truncated: false })
  const missing = await readTextPreview(join(dir, 'nope.txt'))
  assert.equal(missing.kind, 'error')
})

test('UTF-8 BOM is stripped', async () => {
  const dir = await tmp()
  await writeFile(join(dir, 'bom.txt'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hi')]))
  const r = await readTextPreview(join(dir, 'bom.txt'))
  assert.equal(r.kind === 'text' && r.text, 'hi')
})
