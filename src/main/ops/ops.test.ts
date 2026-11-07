import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, readdir, readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OperationQueue, uniquePath } from './queue.ts'
import { streamDirectory } from './list.ts'
import type { OpProgress } from '../../shared/types.ts'

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'orbit-'))
  const events: OpProgress[] = []
  const trashed: string[] = []
  const queue = new OperationQueue(
    async (p) => {
      trashed.push(p)
    },
    (p) => events.push(p)
  )
  const settled = async (id: number) => {
    for (let i = 0; i < 200; i++) {
      const last = [...events].reverse().find((e) => e.id === id)
      if (last && ['done', 'failed', 'cancelled'].includes(last.status)) return last
      await new Promise((r) => setTimeout(r, 10))
    }
    throw new Error('operation did not finish')
  }
  return { dir, queue, events, trashed, settled }
}

test('copy creates unique names and undo removes only the copies', async () => {
  const { dir, queue, settled } = await setup()
  await writeFile(join(dir, 'a.txt'), 'hello')
  await mkdir(join(dir, 'dest'))
  await writeFile(join(dir, 'dest', 'a.txt'), 'existing')

  const id = queue.enqueue({ kind: 'copy', sources: [join(dir, 'a.txt')], target: join(dir, 'dest') })
  assert.equal((await settled(id)).status, 'done')
  assert.deepEqual((await readdir(join(dir, 'dest'))).sort(), ['a (1).txt', 'a.txt'])
  assert.equal(await readFile(join(dir, 'dest', 'a.txt'), 'utf8'), 'existing')

  assert.equal((await queue.undo()).ok, true)
  assert.deepEqual(await readdir(join(dir, 'dest')), ['a.txt'])
})

test('move then undo restores the original location', async () => {
  const { dir, queue, settled } = await setup()
  await writeFile(join(dir, 'm.txt'), 'x')
  await mkdir(join(dir, 'dest'))
  const id = queue.enqueue({ kind: 'move', sources: [join(dir, 'm.txt')], target: join(dir, 'dest') })
  assert.equal((await settled(id)).status, 'done')
  await access(join(dir, 'dest', 'm.txt'))
  assert.equal((await queue.undo()).ok, true)
  await access(join(dir, 'm.txt'))
})

test('rename refuses to overwrite and undo works', async () => {
  const { dir, queue, settled } = await setup()
  await writeFile(join(dir, 'one.txt'), '1')
  await writeFile(join(dir, 'two.txt'), '2')
  const bad = queue.enqueue({ kind: 'rename', sources: [join(dir, 'one.txt')], target: 'two.txt' })
  assert.equal((await settled(bad)).status, 'failed')

  const ok = queue.enqueue({ kind: 'rename', sources: [join(dir, 'one.txt')], target: 'uno.txt' })
  assert.equal((await settled(ok)).status, 'done')
  assert.equal((await queue.undo()).ok, true)
  await access(join(dir, 'one.txt'))
})

test('a folder cannot be moved or copied into itself or its own subfolder, and nothing changes', async () => {
  const { dir, queue, settled } = await setup()
  await mkdir(join(dir, 'top', 'sub'), { recursive: true })
  await writeFile(join(dir, 'top', 'f.txt'), 'x')

  const intoSub = queue.enqueue({ kind: 'move', sources: [join(dir, 'top')], target: join(dir, 'top', 'sub') })
  const r1 = await settled(intoSub)
  assert.equal(r1.status, 'failed')
  assert.match(r1.error ?? '', /into itself/)

  const intoSelf = queue.enqueue({ kind: 'copy', sources: [join(dir, 'top')], target: join(dir, 'top') })
  assert.equal((await settled(intoSelf)).status, 'failed')

  assert.deepEqual((await readdir(join(dir, 'top'))).sort(), ['f.txt', 'sub'])
  assert.deepEqual(await readdir(join(dir, 'top', 'sub')), [])
  assert.equal((await queue.undo()).ok, false) // failed jobs leave nothing to undo
})

test('moving an item into the folder it is already in is a no-op, not a "(1)" rename', async () => {
  const { dir, queue, settled } = await setup()
  await writeFile(join(dir, 'stay.txt'), 's')
  const id = queue.enqueue({ kind: 'move', sources: [join(dir, 'stay.txt')], target: dir })
  const last = await settled(id)
  assert.equal(last.status, 'done')
  assert.equal(last.done, 1)
  assert.deepEqual(await readdir(dir), ['stay.txt'])
  assert.equal((await queue.undo()).ok, false)
})

test('a mixed move only moves the items that are not already there', async () => {
  const { dir, queue, settled } = await setup()
  await mkdir(join(dir, 'a'))
  await mkdir(join(dir, 'b'))
  await writeFile(join(dir, 'a', 'here.txt'), '1')
  await writeFile(join(dir, 'b', 'there.txt'), '2')
  const id = queue.enqueue({
    kind: 'move',
    sources: [join(dir, 'a', 'here.txt'), join(dir, 'b', 'there.txt')],
    target: join(dir, 'a')
  })
  assert.equal((await settled(id)).status, 'done')
  assert.deepEqual((await readdir(join(dir, 'a'))).sort(), ['here.txt', 'there.txt'])
  assert.deepEqual(await readdir(join(dir, 'b')), [])
})

test('trash goes through the injected OS trash function', async () => {
  const { dir, queue, trashed, settled } = await setup()
  await writeFile(join(dir, 't.txt'), 't')
  const id = queue.enqueue({ kind: 'trash', sources: [join(dir, 't.txt')] })
  assert.equal((await settled(id)).status, 'done')
  assert.deepEqual(trashed, [join(dir, 't.txt')])
  assert.equal((await queue.undo()).ok, false) // restoring happens in the OS Recycle Bin
})

test('uniquePath increments suffix', async () => {
  const { dir } = await setup()
  await writeFile(join(dir, 'f.md'), '')
  await writeFile(join(dir, 'f (1).md'), '')
  assert.equal(await uniquePath(join(dir, 'f.md')), join(dir, 'f (2).md'))
})

test('streamDirectory streams large folders in chunks', async () => {
  const { dir } = await setup()
  await Promise.all(Array.from({ length: 1000 }, (_, i) => writeFile(join(dir, `f${i}.txt`), '')))
  const sizes: number[] = []
  const total = await streamDirectory(dir, (c) => sizes.push(c.length), new AbortController().signal)
  assert.equal(total, 1000)
  assert.ok(sizes.length > 1, 'should arrive in more than one chunk')
  assert.equal(sizes.reduce((a, b) => a + b, 0), 1000)
})

test('new folder and new file get unique names, and undo only removes them while empty', async () => {
  const { dir, queue, settled } = await setup()
  const a = await settled(queue.enqueue({ kind: 'mkdir', sources: [], target: dir }))
  const b = await settled(queue.enqueue({ kind: 'mkdir', sources: [], target: dir }))
  assert.equal(a.created, join(dir, 'New folder'))
  assert.equal(b.created, join(dir, 'New folder (1)'))
  const f = await settled(queue.enqueue({ kind: 'newfile', sources: [], target: dir }))
  assert.equal(f.created, join(dir, 'New Text Document.txt'))
  assert.equal(await readFile(f.created!, 'utf8'), '')

  assert.equal((await queue.undo()).ok, true) // removes the empty file
  await assert.rejects(access(join(dir, 'New Text Document.txt')))
  await writeFile(join(b.created!, 'x.txt'), 'work')
  const r = await queue.undo() // folder is no longer empty: refuse
  assert.equal(r.ok, false)
  await access(b.created!)
})

test('invalid names are refused for create and rename', async () => {
  const { dir, queue, settled } = await setup()
  await writeFile(join(dir, 'a.txt'), '')
  for (const bad of ['..\\x', 'a/b', 'what?', 'CON', 'trail.', ' lead']) {
    assert.equal((await settled(queue.enqueue({ kind: 'mkdir', sources: [], target: dir, name: bad }))).status, 'failed', bad)
    assert.equal((await settled(queue.enqueue({ kind: 'rename', sources: [join(dir, 'a.txt')], target: bad }))).status, 'failed', bad)
  }
  await access(join(dir, 'a.txt'))
})

test('zip: single source is named after it, several become Archive.zip, never overwrites, undo removes the zip', async () => {
  const { dir, queue, settled } = await setup()
  await mkdir(join(dir, 'Docs'))
  await writeFile(join(dir, 'Docs', 'a.txt'), 'a'.repeat(1000))
  await writeFile(join(dir, 'b.txt'), 'b')

  const id1 = queue.enqueue({ kind: 'zip', sources: [join(dir, 'Docs')] })
  const r1 = await settled(id1)
  assert.equal(r1.status, 'done')
  assert.equal(r1.created, join(dir, 'Docs.zip'))
  assert.equal(r1.percent, 100)

  const r2 = await settled(queue.enqueue({ kind: 'zip', sources: [join(dir, 'Docs')] }))
  assert.equal(r2.created, join(dir, 'Docs (1).zip'))
  const r3 = await settled(queue.enqueue({ kind: 'zip', sources: [join(dir, 'Docs'), join(dir, 'b.txt')] }))
  assert.equal(r3.created, join(dir, 'Archive.zip'))

  assert.equal((await queue.undo()).ok, true)
  assert.deepEqual((await readdir(dir)).sort(), ['Docs', 'Docs (1).zip', 'Docs.zip', 'b.txt'])
})

test('unzip: folder mode makes a new folder, here mode renames collisions, undo keeps what the user added', async () => {
  const { dir, queue, settled } = await setup()
  await mkdir(join(dir, 'Proj'))
  await writeFile(join(dir, 'Proj', 'a.txt'), 'one')
  const zipPath = (await settled(queue.enqueue({ kind: 'zip', sources: [join(dir, 'Proj')] }))).created as string

  const f = await settled(queue.enqueue({ kind: 'unzip', sources: [zipPath], mode: 'folder' }))
  assert.equal(f.status, 'done')
  assert.equal(f.created, join(dir, 'Proj (1)')) // "Proj" is taken, so the folder is numbered
  assert.equal(await readFile(join(dir, 'Proj (1)', 'Proj', 'a.txt'), 'utf8'), 'one')

  const h = await settled(queue.enqueue({ kind: 'unzip', sources: [zipPath], mode: 'here' }))
  assert.equal(h.status, 'done')
  assert.equal(h.created, join(dir, 'Proj (2)'))
  assert.equal(await readFile(join(dir, 'Proj', 'a.txt'), 'utf8'), 'one') // original untouched
  await writeFile(join(dir, 'Proj (2)', 'mine.txt'), 'mine')

  assert.equal((await queue.undo()).ok, true) // undo "here"
  assert.equal(await readFile(join(dir, 'Proj (2)', 'mine.txt'), 'utf8'), 'mine') // user's file survives
  await readFile(join(dir, 'Proj (2)', 'a.txt'), 'utf8').then(
    () => assert.fail('extracted file should be gone'),
    () => undefined
  )
  assert.equal((await queue.undo()).ok, true) // undo "folder"
  await access(join(dir, 'Proj (1)')).then(
    () => assert.fail('folder should be gone'),
    () => undefined
  )
})

test('unzip: a bad archive fails with a friendly message and leaves nothing; cancel is reported as cancelled', async () => {
  const { dir, queue, settled } = await setup()
  await writeFile(join(dir, 'fake.zip'), 'not a zip')
  const r = await settled(queue.enqueue({ kind: 'unzip', sources: [join(dir, 'fake.zip')], mode: 'folder' }))
  assert.equal(r.status, 'failed')
  assert.match(r.error ?? '', /not a valid ZIP/)
  assert.deepEqual(await readdir(dir), ['fake.zip'])

  await mkdir(join(dir, 'Big'))
  for (let i = 0; i < 20; i++) await writeFile(join(dir, 'Big', `f${i}.dat`), Buffer.alloc(300_000, i))
  const id = queue.enqueue({ kind: 'zip', sources: [join(dir, 'Big')] })
  queue.cancel(id)
  const c = await settled(id)
  assert.equal(c.status, 'cancelled')
  assert.ok(!(await readdir(dir)).some((n) => n.startsWith('Big.zip')))
})
