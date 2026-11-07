import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareEntries } from './sort.ts'
import { fileKind, extensionOf } from './fileKind.ts'
import { pushRecent, timeAgo } from './recents.ts'
import { baseName } from './paths.ts'
import type { FileEntry } from './types.ts'

const f = (name: string, over: Partial<FileEntry> = {}): FileEntry => ({
  name,
  path: `/x/${name}`,
  isDir: false,
  isSymlink: false,
  size: 0,
  mtimeMs: 0,
  ...over
})

test('sort: folders always first, natural name order, direction flips each group', () => {
  const list = [f('file10.txt'), f('file2.txt'), f('Zeta', { isDir: true }), f('alpha', { isDir: true })]
  const asc = list.slice().sort(compareEntries({ key: 'name', dir: 'asc' })).map((e) => e.name)
  assert.deepEqual(asc, ['alpha', 'Zeta', 'file2.txt', 'file10.txt'])
  const desc = list.slice().sort(compareEntries({ key: 'name', dir: 'desc' })).map((e) => e.name)
  assert.deepEqual(desc, ['Zeta', 'alpha', 'file10.txt', 'file2.txt']) // folders still first
})

test('sort: by size and date, ties broken by name', () => {
  const list = [f('b', { size: 5, mtimeMs: 10 }), f('a', { size: 5, mtimeMs: 30 }), f('c', { size: 1, mtimeMs: 20 })]
  assert.deepEqual(
    list.slice().sort(compareEntries({ key: 'size', dir: 'desc' })).map((e) => e.name),
    ['a', 'b', 'c']
  )
  assert.deepEqual(
    list.slice().sort(compareEntries({ key: 'modified', dir: 'desc' })).map((e) => e.name),
    ['a', 'c', 'b']
  )
})

test('fileKind maps extensions, ignores case, and treats dotfiles as plain files', () => {
  assert.equal(fileKind('Photo.JPG', false), 'image')
  assert.equal(fileKind('movie.mkv', false), 'video')
  assert.equal(fileKind('notes.md', false), 'document')
  assert.equal(fileKind('a.tar.gz', false), 'archive')
  assert.equal(fileKind('main.tsx', false), 'code')
  assert.equal(fileKind('.gitignore', false), 'file')
  assert.equal(fileKind('anything.png', true), 'folder')
  assert.equal(extensionOf('noext'), '')
})

test('pushRecent: newest first, de-duplicated case-insensitively, capped', () => {
  let list = pushRecent([], { path: 'C:\\A', name: 'A', isDir: true, ts: 1 })
  list = pushRecent(list, { path: 'C:\\B', name: 'B', isDir: true, ts: 2 })
  list = pushRecent(list, { path: 'c:\\a', name: 'a', isDir: true, ts: 3 })
  assert.deepEqual(list.map((r) => r.name), ['a', 'B'])
  let many = [] as ReturnType<typeof pushRecent>
  for (let i = 0; i < 30; i++) many = pushRecent(many, { path: `/p${i}`, name: `p${i}`, isDir: true, ts: i })
  assert.equal(many.length, 12)
  assert.equal(many[0]?.name, 'p29')
})

test('timeAgo', () => {
  const now = 1_000_000_000_000
  assert.equal(timeAgo(now - 5_000, now), 'just now')
  assert.equal(timeAgo(now - 5 * 60_000, now), '5 min ago')
  assert.equal(timeAgo(now - 3 * 3_600_000, now), '3 h ago')
  assert.equal(timeAgo(now - 26 * 3_600_000, now), 'yesterday')
  assert.equal(timeAgo(now - 4 * 86_400_000, now), '4 days ago')
})

test('baseName', () => {
  assert.equal(baseName('C:\\Users\\Tony'), 'Tony')
  assert.equal(baseName('C:\\Users\\Tony\\'), 'Tony')
  assert.equal(baseName('C:\\'), 'C:\\')
  assert.equal(baseName('/home/tony'), 'tony')
  assert.equal(baseName('/'), '/')
})
