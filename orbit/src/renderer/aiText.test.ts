import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contextLabel, historyFor, inlineParts, suggestions } from './aiText.ts'

const ctx = { cwd: 'C:\\Users\\Tony\\Downloads', otherPane: null, selected: [] as string[], pdf: null as { path: string; page: number } | null }

test('inlineParts: code and bold become parts, everything else (even HTML) stays text', () => {
  assert.deepEqual(inlineParts('Move `C:\\a\\b.pdf` to **Invoices** now'), [
    { kind: 'text', text: 'Move ' },
    { kind: 'code', text: 'C:\\a\\b.pdf' },
    { kind: 'text', text: ' to ' },
    { kind: 'bold', text: 'Invoices' },
    { kind: 'text', text: ' now' }
  ])
  assert.deepEqual(inlineParts('<img src=x onerror=alert(1)>'), [{ kind: 'text', text: '<img src=x onerror=alert(1)>' }])
  assert.deepEqual(inlineParts('unclosed `tick and **star'), [{ kind: 'text', text: 'unclosed `tick and **star' }])
  assert.deepEqual(inlineParts(''), [])
})

test('contextLabel is short and honest about what the AI can see', () => {
  assert.equal(contextLabel(ctx), 'Downloads')
  assert.equal(contextLabel({ ...ctx, cwd: null }), 'Home')
  assert.equal(contextLabel({ ...ctx, selected: ['C:\\x\\a.pdf'] }), 'Downloads · a.pdf')
  assert.equal(contextLabel({ ...ctx, selected: ['1', '2', '3'] }), 'Downloads · 3 selected')
  assert.equal(contextLabel({ ...ctx, selected: ['C:\\x\\book.pdf'], pdf: { path: 'c:\\X\\Book.pdf', page: 2 } }), 'Downloads · Book.pdf p.2')
  assert.equal(contextLabel({ ...ctx, pdf: { path: 'C:\\x\\book.pdf', page: 4 } }), 'Downloads · book.pdf p.4')
})

test('historyFor drops failed and empty turns and ends on the latest question', () => {
  const h = historyFor([
    { role: 'user', text: 'one' },
    { role: 'assistant', text: 'answer' },
    { role: 'user', text: 'two' },
    { role: 'assistant', text: '', failed: true },
    { role: 'user', text: 'three' },
    { role: 'assistant', text: '   ' }
  ])
  assert.deepEqual(h, [
    { role: 'user', content: 'one' },
    { role: 'assistant', content: 'answer' },
    { role: 'user', content: 'two' },
    { role: 'user', content: 'three' }
  ])
  assert.deepEqual(historyFor([]), [])
})

test('suggestions fit the situation and never exceed three', () => {
  assert.deepEqual(suggestions({ ...ctx, cwd: null }), ['What can you help me with?'])
  assert.equal(suggestions({ ...ctx, pdf: { path: 'C:\\b.pdf', page: 2 }, selected: ['C:\\a.txt'] }).length, 3)
  assert.ok(suggestions({ ...ctx, pdf: { path: 'C:\\b.pdf', page: 2 } })[0]?.includes('PDF'))
})
