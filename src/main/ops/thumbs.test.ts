import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readdir, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ThumbnailService } from './thumbs.ts'

async function setup(gen: (p: string) => Promise<Buffer | null>, extra: object = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'orbit-th-'))
  const src = join(dir, 'a.jpg')
  await writeFile(src, 'original')
  const svc = new ThumbnailService({ cacheDir: join(dir, 'cache'), generate: (p) => gen(p), ...extra })
  return { dir, src, svc }
}

test('generates once, then serves from the disk cache', async () => {
  let calls = 0
  const { src, svc } = await setup(async () => (calls++, Buffer.from('png')))
  const a = await svc.get(src)
  const b = await svc.get(src)
  assert.ok(a)
  assert.equal(a, b)
  assert.equal(calls, 1)
})

test('concurrent requests for one file share a single job', async () => {
  let calls = 0
  const { src, svc } = await setup(async () => (calls++, await new Promise((r) => setTimeout(r, 20)), Buffer.from('x')))
  const r = await Promise.all([svc.get(src), svc.get(src), svc.get(src)])
  assert.equal(calls, 1)
  assert.equal(new Set(r).size, 1)
})

test('a changed file gets a new thumbnail', async () => {
  let calls = 0
  const { src, svc } = await setup(async () => (calls++, Buffer.from('x')))
  await svc.get(src)
  await writeFile(src, 'edited and longer')
  await svc.get(src)
  assert.equal(calls, 2)
})

test('failures return null and are not retried', async () => {
  let calls = 0
  const { src, svc } = await setup(async () => (calls++, null))
  assert.equal(await svc.get(src), null)
  assert.equal(await svc.get(src), null)
  assert.equal(calls, 1)
  assert.equal(await svc.get('/no/such/file.png'), null)
})

test('never runs more than the concurrency limit', async () => {
  let live = 0
  let peak = 0
  const { dir, svc } = await setup(
    async () => {
      peak = Math.max(peak, ++live)
      await new Promise((r) => setTimeout(r, 10))
      live--
      return Buffer.from('x')
    },
    { concurrency: 2 }
  )
  const files = await Promise.all(
    Array.from({ length: 8 }, async (_, i) => {
      const f = join(dir, `f${i}.jpg`)
      await writeFile(f, `c${i}`)
      return f
    })
  )
  await Promise.all(files.map((f) => svc.get(f)))
  assert.equal(peak, 2)
})

test('a request cancelled while queued never runs', async () => {
  const started: string[] = []
  const { dir, svc } = await setup(
    async (p) => {
      started.push(p)
      await new Promise((r) => setTimeout(r, 30))
      return Buffer.from('x')
    },
    { concurrency: 1 }
  )
  const f1 = join(dir, 'one.jpg')
  const f2 = join(dir, 'two.jpg')
  await writeFile(f1, '1')
  await writeFile(f2, '2')
  const ac = new AbortController()
  const first = svc.get(f1)
  const second = svc.get(f2, ac.signal)
  await new Promise((r) => setTimeout(r, 5))
  ac.abort()
  assert.equal(await second, null)
  await first
  await new Promise((r) => setTimeout(r, 50))
  assert.deepEqual(started, [f1])
})

test('prune removes the oldest files first', async () => {
  const { dir, svc } = await setup(async () => Buffer.alloc(100), { maxCacheBytes: 250 })
  const made: string[] = []
  for (let i = 0; i < 4; i++) {
    const f = join(dir, `p${i}.jpg`)
    await writeFile(f, `c${i}`)
    const out = await svc.get(f)
    assert.ok(out)
    await utimes(out, 1000 + i, 1000 + i) // p0 oldest
    made.push(out)
  }
  assert.equal(await svc.prune(), 2)
  const left = await readdir(join(dir, 'cache'))
  assert.equal(left.length, 2)
  assert.ok(!left.includes(made[0]!.split(/[\\/]/).pop()!))
})
