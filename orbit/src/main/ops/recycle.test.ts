import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseBinRecord, RecycleBinService } from './recycle.ts'

const SID = 'S-1-5-21-111-222-333-1001'
const EPOCH = 116444736000000000n

/** Builds a version-2 $I record the way Windows 10/11 writes it. */
function record(original: string, size: number, deletedMs: number): Buffer {
  const path = Buffer.from(original + '\0', 'utf16le')
  const b = Buffer.alloc(28 + path.length)
  b.writeBigInt64LE(2n, 0)
  b.writeBigInt64LE(BigInt(size), 8)
  b.writeBigInt64LE(EPOCH + BigInt(deletedMs) * 10000n, 16)
  b.writeInt32LE(original.length + 1, 24)
  path.copy(b, 28)
  return b
}

async function world() {
  const root = await mkdtemp(join(tmpdir(), 'orbit-bin-'))
  const bin = join(root, '$Recycle.Bin', SID)
  await mkdir(bin, { recursive: true })
  const home = join(root, 'home')
  await mkdir(home)
  const svc = (sid: string | null = SID) => new RecycleBinService({ roots: async () => [root], sid: async () => sid }, true)
  /** Puts a file or folder in the bin as Windows would. */
  const trash = async (id: string, originalName: string, content: string | null, binDir = bin) => {
    const ext = originalName.includes('.') ? originalName.slice(originalName.lastIndexOf('.')) : ''
    const original = join(home, originalName)
    await writeFile(join(binDir, `$I${id}${ext}`), record(original, content?.length ?? 0, 1700000000000))
    if (content === null) {
      await mkdir(join(binDir, `$R${id}${ext}`))
      await writeFile(join(binDir, `$R${id}${ext}`, 'inside.txt'), 'x')
    } else await writeFile(join(binDir, `$R${id}${ext}`), content)
    return { r: join(binDir, `$R${id}${ext}`), i: join(binDir, `$I${id}${ext}`), original }
  }
  return { root, bin, home, svc, trash }
}

const exists = (p: string): Promise<boolean> => stat(p).then(() => true, () => false)

test('parseBinRecord reads version 2 and version 1 records and converts the FILETIME', () => {
  const r = parseBinRecord(record('C:\\Users\\Tony\\Documents\\report.docx', 2048, 1700000000000))
  assert.deepEqual(r, { original: 'C:\\Users\\Tony\\Documents\\report.docx', size: 2048, deletedMs: 1700000000000 })

  const v1 = Buffer.alloc(24 + 520)
  v1.writeBigInt64LE(1n, 0)
  v1.writeBigInt64LE(99n, 8)
  v1.writeBigInt64LE(EPOCH + 5000000n, 16)
  Buffer.from('C:\\old\\a.txt\0', 'utf16le').copy(v1, 24)
  assert.equal(parseBinRecord(v1)?.original, 'C:\\old\\a.txt')
})

test('parseBinRecord rejects malformed records', () => {
  assert.equal(parseBinRecord(Buffer.alloc(10)), null)
  const bad = record('C:\\a', 1, 1)
  bad.writeBigInt64LE(7n, 0) // unknown version
  assert.equal(parseBinRecord(bad), null)
  const long = record('C:\\a', 1, 1)
  long.writeInt32LE(99999, 24) // claims more characters than exist
  assert.equal(parseBinRecord(long), null)
})

test('lists items with original name, folder, size and delete time; ignores orphans and junk', async () => {
  const w = await world()
  await w.trash('AAA111', 'notes.txt', 'hello')
  await w.trash('BBB222', 'Old Project', null)
  await writeFile(join(w.bin, '$IORPHAN.txt'), record(join(w.home, 'ghost.txt'), 1, 1)) // no $R
  await writeFile(join(w.bin, 'desktop.ini'), 'junk')
  const r = await w.svc().list()
  assert.equal(r.supported, true)
  assert.equal(r.error, undefined)
  assert.deepEqual(r.items.map((i) => i.name).sort(), ['Old Project', 'notes.txt'])
  const f = r.items.find((i) => i.name === 'notes.txt')!
  assert.equal(f.isDir, false)
  assert.equal(f.size, 5)
  assert.equal(f.deletedMs, 1700000000000)
  assert.equal(f.from, w.home)
  assert.equal(r.items.find((i) => i.name === 'Old Project')!.isDir, true)
})

test('only the current user\'s SID folder is listed; with no SID every readable one is', async () => {
  const w = await world()
  const other = join(w.root, '$Recycle.Bin', 'S-1-5-21-999-999-999-1002')
  await mkdir(other)
  await w.trash('AAA111', 'mine.txt', 'a')
  await w.trash('CCC333', 'theirs.txt', 'b', other)
  assert.deepEqual((await w.svc(SID).list()).items.map((i) => i.name), ['mine.txt'])
  assert.deepEqual((await w.svc(null).list()).items.map((i) => i.name).sort(), ['mine.txt', 'theirs.txt'])
})

test('a drive without a bin, an empty bin and an unsupported platform are all handled', async () => {
  const w = await world()
  assert.deepEqual((await w.svc().list()).items, [])
  const none = new RecycleBinService({ roots: async () => [join(w.root, 'no-such-drive')], sid: async () => SID }, true)
  assert.deepEqual(await none.list(), { supported: true, items: [] })
  const off = new RecycleBinService({ roots: async () => [w.root], sid: async () => SID }, false)
  assert.deepEqual(await off.list(), { supported: false, items: [] })
  assert.equal((await off.purge([join(w.bin, '$RAAA.txt')])).ok, false)
})

test('restore moves the file back, removes the record, and recreates a missing folder', async () => {
  const w = await world()
  const t = await w.trash('AAA111', 'notes.txt', 'hello')
  const res = await w.svc().restore([t.r])
  assert.deepEqual(res, { ok: true, done: 1, message: 'Restored 1 item' })
  assert.equal(await readFile(t.original, 'utf8'), 'hello')
  assert.equal(await exists(t.r), false)
  assert.equal(await exists(t.i), false)

  // original folder gone
  const nested = join(w.home, 'gone', 'deeper')
  await writeFile(join(w.bin, '$IDDD444.txt'), record(join(nested, 'x.txt'), 1, 1))
  await writeFile(join(w.bin, '$RDDD444.txt'), 'x')
  assert.equal((await w.svc().restore([join(w.bin, '$RDDD444.txt')])).ok, true)
  assert.equal(await readFile(join(nested, 'x.txt'), 'utf8'), 'x')
})

test('restore never overwrites: a name clash fails and leaves the bin item alone', async () => {
  const w = await world()
  const t = await w.trash('AAA111', 'notes.txt', 'from the bin')
  await writeFile(t.original, 'newer file')
  const res = await w.svc().restore([t.r])
  assert.equal(res.ok, false)
  assert.match(res.message, /already exists/)
  assert.equal(await readFile(t.original, 'utf8'), 'newer file')
  assert.equal(await exists(t.r), true)
  assert.equal(await exists(t.i), true)
})

test('restoring a folder brings back its contents', async () => {
  const w = await world()
  const t = await w.trash('FFF666', 'Old Project', null)
  assert.equal((await w.svc().restore([t.r])).ok, true)
  assert.equal(await readFile(join(t.original, 'inside.txt'), 'utf8'), 'x')
})

test('purge deletes the data and the record, folders included', async () => {
  const w = await world()
  const a = await w.trash('AAA111', 'notes.txt', 'hello')
  const b = await w.trash('BBB222', 'Old Project', null)
  const res = await w.svc().purge([a.r, b.r])
  assert.deepEqual(res, { ok: true, done: 2, message: 'Permanently deleted 2 items' })
  assert.deepEqual(await readdir(w.bin), [])
})

test('empty removes every item', async () => {
  const w = await world()
  await w.trash('AAA111', 'a.txt', '1')
  await w.trash('BBB222', 'b.txt', '2')
  assert.equal((await w.svc().empty()).message, 'Recycle Bin emptied')
  assert.deepEqual((await w.svc().list()).items, [])
  assert.equal((await w.svc().empty()).message, 'The Recycle Bin is already empty')
})

test('refuses ids that are not plain $R items directly inside our bin folder', async () => {
  const w = await world()
  const victim = join(w.home, 'precious.txt')
  await writeFile(victim, 'keep me')
  const mine = await w.trash('AAA111', 'notes.txt', 'hello')
  const other = join(w.root, '$Recycle.Bin', 'S-1-5-21-999-999-999-1002')
  await mkdir(other)
  const theirs = await w.trash('CCC333', 'theirs.txt', 'b', other)
  const bad: unknown[] = [
    victim, // a normal file
    [victim],
    [join(w.bin, '..', '..', 'home', 'precious.txt')], // traversal
    [join(w.bin, '$R..', 'x')],
    [mine.i], // the record, not the item
    [theirs.r], // someone else's bin folder
    [mine.r, victim], // one bad id spoils the whole request
    [mine.r + '\0'],
    [], 'nope', null, undefined, [42]
  ]
  for (const ids of bad) {
    assert.equal((await w.svc().purge(ids)).ok, false, JSON.stringify(ids))
    assert.equal((await w.svc().restore(ids)).ok, false, JSON.stringify(ids))
  }
  assert.equal(await readFile(victim, 'utf8'), 'keep me')
  assert.equal(await exists(mine.r), true)
  assert.equal(await exists(theirs.r), true)
})

test('items from several drives are combined', async () => {
  const w = await world()
  const root2 = await mkdtemp(join(tmpdir(), 'orbit-bin2-'))
  const bin2 = join(root2, '$Recycle.Bin', SID)
  await mkdir(bin2, { recursive: true })
  await w.trash('AAA111', 'c-drive.txt', 'a')
  await w.trash('BBB222', 'd-drive.txt', 'b', bin2)
  const both = new RecycleBinService({ roots: async () => [w.root, root2], sid: async () => SID }, true)
  assert.deepEqual((await both.list()).items.map((i) => i.name).sort(), ['c-drive.txt', 'd-drive.txt'])
})

test('an empty list that is caused by a SID mismatch says so', async () => {
  const w = await world()
  const wrong = new RecycleBinService({ roots: async () => [w.root], sid: async () => 'S-1-5-21-5-5-5-1' }, true)
  await w.trash('AAA111', 'notes.txt', 'hello')
  const r = await wrong.list()
  assert.equal(r.items.length, 0)
  assert.match(r.error ?? '', /No Recycle Bin folder for your account \(S-1-5-21-5-5-5-1\)/)
  assert.equal((await w.svc().list()).error, undefined) // a genuinely empty bin has no error
})
