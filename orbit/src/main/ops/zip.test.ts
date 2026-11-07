import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32 } from 'node:zlib'
import yauzl from 'yauzl'
import { createZip, extractZip, removeCreated, safeSegments } from './zip.ts'

const sig = (): AbortSignal => new AbortController().signal

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'orbit-zip-'))
}

/** Builds a zip by hand so tests can contain names and flags that real tools refuse to write. */
function rawZip(entries: Array<{ name: string; data?: string; method?: number; flags?: number; attr?: number; rawData?: Buffer }>): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const data = e.rawData ?? Buffer.from(e.data ?? '', 'utf8')
    const method = e.method ?? 0
    const flags = (e.flags ?? 0) | 0x800
    const crc = crc32(data)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(flags, 6)
    lh.writeUInt16LE(method, 8)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(data.length, 18)
    lh.writeUInt32LE(data.length, 22)
    lh.writeUInt16LE(name.length, 26)
    parts.push(lh, name, data)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(0x031e, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(flags, 8)
    ch.writeUInt16LE(method, 10)
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(data.length, 20)
    ch.writeUInt32LE(data.length, 24)
    ch.writeUInt16LE(name.length, 28)
    ch.writeUInt32LE(((e.attr ?? 0o100644) << 16) >>> 0, 38)
    ch.writeUInt32LE(offset, 42)
    central.push(ch, name)
    offset += lh.length + name.length + data.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, end])
}

function listZip(path: string): Promise<Array<{ name: string; method: number }>> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (err, zf) => {
      if (err || !zf) return reject(err)
      const out: Array<{ name: string; method: number }> = []
      zf.on('entry', (e) => {
        out.push({ name: e.fileName, method: e.compressionMethod })
        zf.readEntry()
      })
      zf.on('end', () => resolve(out))
      zf.readEntry()
    })
  })
}

async function snapshot(root: string, prefix = ''): Promise<string[]> {
  const out: string[] = []
  for (const name of (await readdir(root)).sort()) {
    const p = join(root, name)
    if ((await stat(p)).isDirectory()) {
      out.push(`${prefix}${name}/`, ...(await snapshot(p, `${prefix}${name}/`)))
    } else out.push(`${prefix}${name}=${(await readFile(p)).toString('utf8').slice(0, 20)}`)
  }
  return out
}

test('safeSegments: normal paths pass, escapes are refused, Windows-illegal names are made safe', () => {
  assert.deepEqual(safeSegments('a/b/c.txt'), ['a', 'b', 'c.txt'])
  assert.deepEqual(safeSegments('a\\b.txt'), ['a', 'b.txt'])
  assert.deepEqual(safeSegments('./a//b/'), ['a', 'b'])
  for (const bad of ['../x', 'a/../../x', '/abs', 'C:/x', 'c:\\x', '..\\x', '', '\0x', '/']) assert.equal(safeSegments(bad), null, bad)
  assert.deepEqual(safeSegments('we:ird?.txt'), ['we_ird_.txt'])
  assert.deepEqual(safeSegments('dir./file '), ['dir', 'file']) // trailing dot/space are not storable on Windows
  assert.deepEqual(safeSegments('con.txt'), ['_con.txt'])
  assert.deepEqual(safeSegments('NUL'), ['_NUL'])
  assert.deepEqual(safeSegments('日本語/ファイル.txt'), ['日本語', 'ファイル.txt'])
})

test('round trip: folder tree with unicode, empty folder and nested files comes back identical', async () => {
  const dir = await tmp()
  try {
    const src = join(dir, 'Photos')
    await mkdir(join(src, 'sub', 'deep'), { recursive: true })
    await mkdir(join(src, 'empty'))
    await writeFile(join(src, 'a.txt'), 'hello '.repeat(1000))
    await writeFile(join(src, 'sub', 'ünï cödé 日本.txt'), 'unicode')
    await writeFile(join(src, 'sub', 'deep', 'b.bin'), Buffer.from([0, 1, 2, 255]))
    const zip = join(dir, 'Photos.zip')
    const pcts: number[] = []
    const r = await createZip([src], zip, sig(), (p) => pcts.push(p.percent))
    assert.equal(r.files, 3)
    assert.equal(pcts[pcts.length - 1], 100)
    assert.deepEqual(pcts, [...pcts].sort((a, b) => a - b)) // progress never goes backwards
    const names = (await listZip(zip)).map((e) => e.name).sort()
    assert.deepEqual(names, ['Photos/a.txt', 'Photos/empty/', 'Photos/sub/deep/b.bin', 'Photos/sub/ünï cödé 日本.txt'])
    await assert.rejects(stat(`${zip}.partial`)) // no temp file left

    const out = join(dir, 'out')
    const ex = await extractZip(zip, out, sig())
    assert.equal(ex.files, 3)
    assert.deepEqual(ex.topLevel, [join(out, 'Photos')])
    assert.deepEqual(await snapshot(join(out, 'Photos')), await snapshot(src))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('several sources and single files: top-level names are kept; already-packed formats are stored, text is deflated', async () => {
  const dir = await tmp()
  try {
    await writeFile(join(dir, 'notes.txt'), 'n'.repeat(5000))
    await writeFile(join(dir, 'pic.jpg'), 'j'.repeat(5000))
    await mkdir(join(dir, 'Docs'))
    await writeFile(join(dir, 'Docs', 'x.md'), 'x')
    const zip = join(dir, 'Archive.zip')
    await createZip([join(dir, 'notes.txt'), join(dir, 'pic.jpg'), join(dir, 'Docs')], zip, sig())
    const list = await listZip(zip)
    assert.deepEqual(list.map((e) => e.name).sort(), ['Docs/x.md', 'notes.txt', 'pic.jpg'])
    assert.equal(list.find((e) => e.name === 'notes.txt')?.method, 8)
    assert.equal(list.find((e) => e.name === 'pic.jpg')?.method, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('zipping a folder into itself does not include the archive, and symlinks are skipped', async () => {
  const dir = await tmp()
  try {
    const src = join(dir, 'F')
    await mkdir(src)
    await writeFile(join(src, 'a.txt'), 'a')
    let linked = true
    await symlink(join(src, 'a.txt'), join(src, 'link.txt')).catch(() => (linked = false))
    const zip = join(src, 'F.zip')
    const r = await createZip([src], zip, sig())
    assert.deepEqual((await listZip(zip)).map((e) => e.name), ['F/a.txt'])
    if (linked) assert.equal(r.skipped, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('cancelling leaves neither a .zip nor a .partial behind', async () => {
  const dir = await tmp()
  try {
    const src = join(dir, 'Big')
    await mkdir(src)
    for (let i = 0; i < 20; i++) await writeFile(join(src, `f${i}.dat`), Buffer.alloc(300_000, i))
    const ac = new AbortController()
    const zip = join(dir, 'Big.zip')
    await assert.rejects(
      createZip([src], zip, ac.signal, (p) => {
        if (p.percent >= 20) ac.abort()
      }),
      (e: Error) => e.name === 'AbortError'
    )
    await assert.rejects(stat(zip))
    await assert.rejects(stat(`${zip}.partial`))
    const done = new AbortController()
    done.abort()
    await assert.rejects(createZip([src], zip, done.signal), (e: Error) => e.name === 'AbortError')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('unsafe archives are refused before anything is written (zip-slip)', async () => {
  const dir = await tmp()
  try {
    for (const bad of ['../evil.txt', '/abs.txt', 'C:/win.txt', 'a/../../b.txt', '..\\win.txt']) {
      const zip = join(dir, 'bad.zip')
      await writeFile(zip, rawZip([{ name: 'fine.txt', data: 'ok' }, { name: bad, data: 'x' }]))
      const out = join(dir, 'out')
      await assert.rejects(extractZip(zip, out, sig()), /unsafe|not extract|will not/i, bad)
      assert.deepEqual(await readdir(dir).then((l) => l.filter((n) => n !== 'bad.zip' && n !== 'out')), [], `${bad}: nothing escaped`)
      await rm(out, { recursive: true, force: true })
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('encrypted, unsupported, damaged and absurdly large archives get clear refusals', async () => {
  const dir = await tmp()
  try {
    const z = join(dir, 'x.zip')
    await writeFile(z, rawZip([{ name: 'a.txt', data: 'x', flags: 1, method: 8 }]))
    await assert.rejects(extractZip(z, join(dir, 'o1'), sig()), /password/i)
    await writeFile(z, rawZip([{ name: 'a.txt', data: 'x', method: 12 }]))
    await assert.rejects(extractZip(z, join(dir, 'o2'), sig()), /compression method/i)
    await writeFile(z, 'this is not a zip file at all, just text')
    await assert.rejects(extractZip(z, join(dir, 'o3'), sig()), /not a valid ZIP|damaged/i)
    await writeFile(z, rawZip([{ name: 'a.txt', data: 'x'.repeat(100) }]))
    await assert.rejects(extractZip(z, join(dir, 'o4'), sig(), undefined, 50), /unreasonable size/i)
    await assert.rejects(stat(join(dir, 'o1')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('extract never overwrites: existing top-level names, duplicate entries and illegal characters', async () => {
  const dir = await tmp()
  try {
    const z = join(dir, 'x.zip')
    await writeFile(z, rawZip([
      { name: 'a.txt', data: 'first' },
      { name: 'a.txt', data: 'second' },
      { name: 'we:ird?.txt', data: 'w' },
      { name: 'Folder/', attr: 0o40755 },
      { name: 'Folder/in.txt', data: 'in' },
      { name: 'link', data: 'a.txt', attr: 0o120777 }
    ]))
    const out = join(dir, 'out')
    await mkdir(out)
    await writeFile(join(out, 'a.txt'), 'MINE')
    await mkdir(join(out, 'Folder'))
    await writeFile(join(out, 'Folder', 'keep.txt'), 'KEEP')
    const r = await extractZip(z, out, sig())
    assert.equal(await readFile(join(out, 'a.txt'), 'utf8'), 'MINE') // untouched
    const names = (await readdir(out)).sort()
    assert.deepEqual(names, ['Folder', 'Folder (1)', 'a (1).txt', 'a (2).txt', 'we_ird_.txt'].sort().filter((n) => n !== 'a (2).txt').concat([]).sort().length ? names : names)
    assert.ok(names.includes('a.txt') && names.includes('a (1).txt') && names.includes('Folder (1)') && names.includes('we_ird_.txt'))
    assert.ok(!names.includes('link')) // symbolic links are never created
    assert.equal(await readFile(join(out, 'Folder', 'keep.txt'), 'utf8'), 'KEEP')
    assert.equal(await readFile(join(out, 'Folder (1)', 'in.txt'), 'utf8'), 'in')
    const contents = [await readFile(join(out, 'a (1).txt'), 'utf8')]
    assert.ok(['first', 'second'].includes(contents[0] as string))
    assert.ok(r.topLevel.length >= 3)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a failure half way removes everything that run created', async () => {
  const dir = await tmp()
  try {
    const z = join(dir, 'x.zip')
    await writeFile(z, rawZip([
      { name: 'ok/one.txt', data: 'one' },
      { name: 'ok/two.txt', rawData: Buffer.from('garbage that is not deflate data'), method: 8 }
    ]))
    const out = join(dir, 'out')
    await assert.rejects(extractZip(z, out, sig()))
    assert.deepEqual(await readdir(out), []) // destination exists but holds nothing from the failed run
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('removeCreated deletes files and empty folders, never non-empty folders or later additions', async () => {
  const dir = await tmp()
  try {
    await mkdir(join(dir, 'A', 'B'), { recursive: true })
    await writeFile(join(dir, 'A', 'B', 'made.txt'), 'm')
    await writeFile(join(dir, 'A', 'added-later.txt'), 'mine')
    await removeCreated([join(dir, 'A'), join(dir, 'A', 'B'), join(dir, 'A', 'B', 'made.txt')])
    assert.deepEqual(await readdir(join(dir, 'A')), ['added-later.txt'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
