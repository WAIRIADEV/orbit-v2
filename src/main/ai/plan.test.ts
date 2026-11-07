import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validatePlan, type StatFn } from './plan.ts'

// A fake disk (Windows-style paths, case-insensitive like NTFS).
const disk = new Map<string, 'dir' | 'file'>(
  [
    ['C:\\d', 'dir'],
    ['C:\\d\\a.pdf', 'file'],
    ['C:\\d\\b.pdf', 'file'],
    ['C:\\d\\sub', 'dir'],
    ['C:\\d\\taken.txt', 'file']
  ].map(([p, k]) => [p!.toLowerCase(), k as 'dir' | 'file'])
)
const stat: StatFn = async (p) => disk.get(p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()) ?? null
const plan = (actions: unknown[]) => validatePlan({ title: 'T', actions }, stat)

test('a valid plan passes, including a move into a folder created earlier in the same plan', async () => {
  const r = await plan([
    { type: 'mkdir', parent: 'C:\\d', name: 'Invoices' },
    { type: 'move', paths: ['C:\\d\\a.pdf', 'C:\\d\\b.pdf'], to: 'C:\\d\\Invoices' },
    { type: 'rename', path: 'C:\\d\\taken.txt', newName: 'notes.txt' }
  ])
  assert.ok(r.ok)
  if (r.ok) assert.equal(r.plan.actions.length, 3)
})

test('refuses a move into a folder that neither exists nor is created first', async () => {
  const r = await plan([{ type: 'move', paths: ['C:\\d\\a.pdf'], to: 'C:\\d\\Nope' }])
  assert.ok(!r.ok && /does not exist.*mkdir/.test(r.error))
})

test('refuses missing sources, existing folders, taken names, illegal names and relative paths', async () => {
  const bad = async (a: unknown, re: RegExp): Promise<void> => {
    const r = await plan([a])
    assert.ok(!r.ok && re.test(r.error), JSON.stringify(a) + ' -> ' + (r.ok ? 'ok' : r.error))
  }
  await bad({ type: 'move', paths: ['C:\\d\\ghost.pdf'], to: 'C:\\d\\sub' }, /does not exist/)
  await bad({ type: 'mkdir', parent: 'C:\\d', name: 'sub' }, /already exists/)
  await bad({ type: 'mkdir', parent: 'C:\\d', name: 'a/b' }, /name/i)
  await bad({ type: 'mkdir', parent: 'C:\\nowhere', name: 'x' }, /parent folder/)
  await bad({ type: 'rename', path: 'C:\\d\\a.pdf', newName: 'taken.txt' }, /already exists/)
  await bad({ type: 'rename', path: 'C:\\d\\a.pdf', newName: '..' }, /not allowed/)
  await bad({ type: 'move', paths: ['a.pdf'], to: 'C:\\d\\sub' }, /absolute/)
  await bad({ type: 'trash', paths: [] }, /non-empty/)
  await bad({ type: 'trash', paths: [42] }, /absolute/)
})

test('no permanent delete, no unknown actions, no moving a folder into itself', async () => {
  const r1 = await plan([{ type: 'delete', paths: ['C:\\d\\a.pdf'] }])
  assert.ok(!r1.ok && /Permanent delete does not exist/.test(r1.error))
  const r2 = await plan([{ type: 'move', paths: ['C:\\d\\sub'], to: 'C:\\d\\sub' }])
  assert.ok(!r2.ok && /inside itself/.test(r2.error))
  const r3 = await plan([{ type: 'move', paths: ['C:\\d'], to: 'C:\\d\\sub' }])
  assert.ok(!r3.ok && /inside itself/.test(r3.error))
})

test('an item cannot be used again after it was moved or trashed in the same plan', async () => {
  const r = await plan([
    { type: 'move', paths: ['C:\\d\\a.pdf'], to: 'C:\\d\\sub' },
    { type: 'trash', paths: ['C:\\d\\a.pdf'] }
  ])
  assert.ok(!r.ok && /already moved/.test(r.error))
})

test('shape checks: not an object, empty, too many actions, title fallback', async () => {
  assert.ok(!(await validatePlan(null, stat)).ok)
  assert.ok(!(await validatePlan({ title: 't', actions: [] }, stat)).ok)
  const many = Array.from({ length: 41 }, () => ({ type: 'trash', paths: ['C:\\d\\a.pdf'] }))
  const r = await validatePlan({ actions: many }, stat)
  assert.ok(!r.ok && /Too many/.test(r.error))
  const ok = await validatePlan({ actions: [{ type: 'trash', paths: ['C:\\d\\a.pdf'] }] }, stat)
  assert.ok(ok.ok && ok.plan.title === 'Proposed changes')
})
