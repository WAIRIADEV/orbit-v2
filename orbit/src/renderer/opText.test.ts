import { test } from 'node:test'
import assert from 'node:assert/strict'
import { opActiveText, opDoneText } from './opText.ts'
import type { OpProgress } from '../shared/types.ts'

const op = (o: Partial<OpProgress>): OpProgress => ({ id: 1, kind: 'copy', status: 'running', done: 1, total: 3, ...o })

test('active text: copy shows counts, zip and unzip show percent and the current file name only', () => {
  assert.equal(opActiveText(op({ current: 'a.txt' })), 'copy 1/3 · a.txt')
  assert.equal(opActiveText(op({ kind: 'zip', percent: 42, current: 'Photos/2024/a.jpg' })), 'Compressing 42% · a.jpg')
  assert.equal(opActiveText(op({ kind: 'unzip', percent: 7 })), 'Extracting 7%')
  assert.equal(opActiveText(op({ kind: 'zip', status: 'queued' })), 'Compressing… (waiting)')
  assert.equal(opActiveText(op({ kind: 'unzip', percent: undefined, current: 'C:\\x\\y.txt' })), 'Extracting 0% · y.txt')
})

test('done text: created archive and extracted folder are named; other ops stay quiet', () => {
  assert.equal(opDoneText(op({ kind: 'zip', status: 'done', created: 'C:\\Users\\t\\Docs.zip' })), 'Created Docs.zip')
  assert.equal(opDoneText(op({ kind: 'unzip', status: 'done', created: '/home/t/Proj (1)/' })), 'Extracted to Proj (1)')
  assert.equal(opDoneText(op({ kind: 'copy', status: 'done' })), null)
  assert.equal(opDoneText(op({ kind: 'zip', status: 'cancelled' })), 'Compression cancelled')
  assert.equal(opDoneText(op({ kind: 'zip', status: 'running' })), null)
})
