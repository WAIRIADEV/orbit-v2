import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeAction, planToRequests } from './aiPlan.ts'
import type { AiPlan } from './types.ts'

const plan: AiPlan = {
  title: 'Tidy Downloads',
  actions: [
    { type: 'mkdir', parent: 'C:\\Users\\Tony\\Downloads', name: 'Invoices' },
    { type: 'move', paths: ['C:\\Users\\Tony\\Downloads\\a.pdf', 'C:\\Users\\Tony\\Downloads\\b.pdf'], to: 'C:\\Users\\Tony\\Downloads\\Invoices' },
    { type: 'rename', path: 'C:\\Users\\Tony\\Downloads\\c.txt', newName: 'notes.txt' },
    { type: 'copy', paths: ['C:\\x\\d.txt'], to: 'D:\\backup' },
    { type: 'trash', paths: ['C:\\x\\old.tmp'] }
  ]
}

test('planToRequests keeps order and maps each action onto the operation queue', () => {
  assert.deepEqual(planToRequests(plan), [
    { kind: 'mkdir', sources: [], target: 'C:\\Users\\Tony\\Downloads', name: 'Invoices' },
    { kind: 'move', sources: ['C:\\Users\\Tony\\Downloads\\a.pdf', 'C:\\Users\\Tony\\Downloads\\b.pdf'], target: 'C:\\Users\\Tony\\Downloads\\Invoices' },
    { kind: 'rename', sources: ['C:\\Users\\Tony\\Downloads\\c.txt'], target: 'notes.txt' },
    { kind: 'copy', sources: ['C:\\x\\d.txt'], target: 'D:\\backup' },
    { kind: 'trash', sources: ['C:\\x\\old.tmp'] }
  ])
})

test('describeAction reads as plain English and never says "delete"', () => {
  const lines = plan.actions.map(describeAction)
  assert.deepEqual(lines, [
    'Create folder “Invoices” in Downloads',
    'Move 2 items to Invoices',
    'Rename “c.txt” to “notes.txt”',
    'Copy “d.txt” to backup',
    'Move “old.tmp” to the Recycle Bin'
  ])
  assert.ok(lines.every((l) => !/delete/i.test(l)))
})
