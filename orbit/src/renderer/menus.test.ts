import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backgroundMenu, binBackgroundMenu, binItemMenu, itemMenu, type ItemActions, type BackgroundActions } from './menus.ts'

const noop = (): void => undefined
const itemActions: ItemActions = { open: noop, openDefault: noop, openOtherPane: noop, quickLook: noop, cut: noop, copy: noop, pasteInto: noop, rename: noop, trash: noop, copyPath: noop, reveal: noop, compress: noop, extractFolder: noop, extractHere: noop }
const bgActions: BackgroundActions = { newFolder: noop, newTextFile: noop, setLayout: noop, setSortKey: noop, setSortDir: noop, refresh: noop, paste: noop, undo: noop, selectAll: noop, copyPath: noop, openInExplorer: noop }

const labels = (m: ReturnType<typeof itemMenu>): string[] =>
  m.flatMap((e) => (e.type === 'item' || e.type === 'sub' ? [e.label] : e.type === 'row' ? e.buttons.map((b) => b.label) : []))
const base = { count: 1, single: { isDir: false }, canPaste: false, dual: false, deep: false }

test('a file gets Open, Quick Look and the icon row, but no folder-only entries', () => {
  const l = labels(itemMenu(base, itemActions))
  for (const want of ['Cut', 'Copy', 'Rename', 'Delete', 'Open', 'Quick Look', 'Copy as path', 'Show in Explorer']) assert.ok(l.includes(want), want)
  assert.ok(!l.includes('Open in other pane') && !l.includes('Paste into folder'))
})

test('a folder offers other-pane and paste only when they make sense', () => {
  const folder = { ...base, single: { isDir: true } }
  assert.ok(!labels(itemMenu(folder, itemActions)).includes('Open in other pane'))
  assert.ok(labels(itemMenu({ ...folder, dual: true }, itemActions)).includes('Open in other pane'))
  assert.ok(!labels(itemMenu(folder, itemActions)).includes('Paste into folder'))
  assert.ok(labels(itemMenu({ ...folder, canPaste: true }, itemActions)).includes('Paste into folder'))
  assert.ok(!labels(itemMenu(folder, itemActions)).includes('Quick Look'))
})

test('multi-selection: no Open / Explorer, Rename disabled', () => {
  const m = itemMenu({ ...base, count: 3, single: null }, itemActions)
  const l = labels(m)
  assert.ok(!l.includes('Open') && !l.includes('Show in Explorer'))
  const row = m[0]
  assert.equal(row?.type, 'row')
  if (row?.type === 'row') assert.equal(row.buttons.find((b) => b.label === 'Rename')?.disabled, true)
})

test('search results: Show in folder instead of Open, Rename disabled', () => {
  const m = itemMenu({ ...base, deep: true }, itemActions)
  assert.ok(labels(m).includes('Show in folder') && !labels(m).includes('Open'))
})

test('menu actions are wired to the right callbacks', () => {
  const hit: string[] = []
  const a = { ...itemActions, cut: () => hit.push('cut'), trash: () => hit.push('trash') }
  const row = itemMenu(base, a)[0]
  if (row?.type !== 'row') throw new Error('no row')
  row.buttons.find((b) => b.label === 'Cut')?.onSelect()
  row.buttons.find((b) => b.label === 'Delete')?.onSelect()
  assert.deepEqual(hit, ['cut', 'trash'])
})

test('background menu: Paste disabled when the clipboard is empty, current view/sort are ticked', () => {
  const m = backgroundMenu({ layout: 'grid', sortKey: 'size', sortDir: 'desc', canPaste: false }, bgActions)
  const paste = m.find((e) => e.type === 'item' && e.label === 'Paste')
  assert.equal(paste?.type === 'item' && paste.disabled, true)
  const view = m.find((e) => e.type === 'sub' && e.label === 'View')
  const ticked = (view?.type === 'sub' ? view.items : []).filter((i) => i.type === 'item' && i.checked).map((i) => (i.type === 'item' ? i.label : ''))
  assert.deepEqual(ticked, ['Icons'])
  const sort = m.find((e) => e.type === 'sub' && e.label === 'Sort by')
  const sticks = (sort?.type === 'sub' ? sort.items : []).filter((i) => i.type === 'item' && i.checked).map((i) => (i.type === 'item' ? i.label : ''))
  assert.deepEqual(sticks, ['Size', 'Descending'])
  assert.ok(m.some((e) => e.type === 'sub' && e.label === 'New'))
})

test('Recycle Bin menus', () => {
  const noopBin = { restore: noop, purge: noop, selectAll: noop, empty: noop, refresh: noop }
  const one = binItemMenu(1, noopBin)
  assert.equal(one[0]?.type === 'item' && one[0].label, 'Restore')
  const many = binItemMenu(12, noopBin)
  assert.equal(many[0]?.type === 'item' && many[0].label, 'Restore 12 items')
  const empty = binBackgroundMenu(false, noopBin)
  assert.equal(empty[0]?.type === 'item' && empty[0].disabled, true)
  assert.equal(binBackgroundMenu(true, noopBin)[0]?.type === 'item' && (binBackgroundMenu(true, noopBin)[0] as { disabled?: boolean }).disabled, false)
})

test('a PDF also offers the default app; other files and search results do not', () => {
  assert.ok(labels(itemMenu({ ...base, single: { isDir: false, pdf: true } }, itemActions)).includes('Open with default app'))
  assert.ok(!labels(itemMenu(base, itemActions)).includes('Open with default app'))
  assert.ok(!labels(itemMenu({ ...base, deep: true, single: { isDir: false, pdf: true } }, itemActions)).includes('Open with default app'))
})

test('ZIP: every selection can be compressed; only a single .zip offers extraction', () => {
  assert.ok(labels(itemMenu(base, itemActions)).includes('Compress to ZIP'))
  assert.ok(labels(itemMenu({ ...base, count: 3, single: null }, itemActions)).includes('Compress 3 items to ZIP'))
  assert.ok(!labels(itemMenu(base, itemActions)).includes('Extract here'))
  const z = labels(itemMenu({ ...base, single: { isDir: false, zip: true } }, itemActions))
  assert.ok(z.includes('Extract to folder') && z.includes('Extract here') && z.includes('Compress to ZIP'))
  // In search results "here" would be ambiguous, so only the explicit folder option is offered.
  const deep = labels(itemMenu({ ...base, deep: true, single: { isDir: false, zip: true } }, itemActions))
  assert.ok(deep.includes('Extract to folder') && !deep.includes('Extract here'))
})
