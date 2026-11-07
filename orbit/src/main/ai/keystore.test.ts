import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KeyStore, type Safe } from './keystore.ts'

const rot = (s: string): string => [...s].reverse().join('')
const fakeSafe = (available: boolean): Safe => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(rot(s)),
  decryptString: (b) => rot(b.toString())
})

test('key is stored encrypted (never as plain text) and survives a restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbit-key-'))
  try {
    const file = join(dir, 'sub', 'groq.key')
    const a = new KeyStore(file, fakeSafe(true))
    await a.load()
    assert.equal(a.get(), null)
    await a.set('  gsk_SECRET123  ')
    assert.equal(a.get(), 'gsk_SECRET123')
    const onDisk = (await readFile(file)).toString()
    assert.ok(!onDisk.includes('gsk_SECRET123'))

    const b = new KeyStore(file, fakeSafe(true))
    await b.load()
    assert.equal(b.get(), 'gsk_SECRET123')

    await b.clear()
    assert.equal(b.get(), null)
    await assert.rejects(stat(file))
    await b.clear() // clearing twice is fine
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('without OS encryption the key stays in memory only and nothing is written', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbit-key-'))
  try {
    const file = join(dir, 'groq.key')
    const s = new KeyStore(file, fakeSafe(false))
    assert.equal(s.canEncrypt, false)
    await s.set('gsk_abc')
    assert.equal(s.get(), 'gsk_abc')
    await assert.rejects(stat(file))
    const again = new KeyStore(file, fakeSafe(false))
    await again.load()
    assert.equal(again.get(), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a corrupt or foreign key file loads as "no key" instead of crashing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbit-key-'))
  try {
    const file = join(dir, 'groq.key')
    const safe: Safe = { ...fakeSafe(true), decryptString: () => { throw new Error('wrong user') } }
    await new KeyStore(file, fakeSafe(true)).set('x')
    const s = new KeyStore(file, safe)
    await s.load()
    assert.equal(s.get(), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
