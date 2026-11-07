import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { searchTree } from './search.ts'
import type { FileEntry } from '../../shared/types.ts'

async function tree() {
  const root = await mkdtemp(join(tmpdir(), 'orbit-search-'))
  await mkdir(join(root, 'a'))
  await mkdir(join(root, 'b', 'c'), { recursive: true })
  await mkdir(join(root, '$Recycle.Bin'))
  await writeFile(join(root, 'a', 'Report.txt'), '')
  await writeFile(join(root, 'b', 'c', 'report-final.docx'), '')
  await writeFile(join(root, 'b', 'x.txt'), '')
  await writeFile(join(root, '$Recycle.Bin', 'report-hidden.txt'), '')
  return root
}

async function run(root: string, query: string, max?: number, signal = new AbortController().signal) {
  const found: FileEntry[] = []
  const result = await searchTree(root, query, (c) => found.push(...c), signal, max)
  return { found, result }
}

test('finds matches in nested folders, case-insensitively, skipping system folders', async () => {
  const root = await tree()
  const { found, result } = await run(root, 'REPORT')
  assert.deepEqual(found.map((e) => e.name).sort(), ['Report.txt', 'report-final.docx'])
  assert.equal(result.total, 2)
  assert.equal(result.limited, false)
})

test('all words must match', async () => {
  const root = await tree()
  const { found } = await run(root, 'final docx')
  assert.deepEqual(found.map((e) => e.name), ['report-final.docx'])
})

test('shallow matches come first', async () => {
  const root = await tree()
  await writeFile(join(root, 'report-top.txt'), '')
  const { found } = await run(root, 'report')
  assert.equal(found[0]?.name, 'report-top.txt')
})

test('stops at the result limit and says so', async () => {
  const root = await tree()
  const { found, result } = await run(root, 'txt', 1)
  assert.equal(found.length, 1)
  assert.equal(result.limited, true)
})

test('an already-aborted search returns nothing', async () => {
  const root = await tree()
  const controller = new AbortController()
  controller.abort()
  const { found } = await run(root, 'report', undefined, controller.signal)
  assert.equal(found.length, 0)
})

test('a missing folder does not throw', async () => {
  const { found, result } = await run(join(tmpdir(), 'orbit-does-not-exist-xyz'), 'a')
  assert.equal(found.length, 0)
  assert.equal(result.total, 0)
})
