import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkOpenable } from './openPath.ts'

test('rejects non-strings, empty, relative and NUL paths', async () => {
  for (const bad of [undefined, 42, '', 'relative/file.txt', 'a\0b', '/tmp/x\0']) {
    assert.notEqual(await checkOpenable(bad), null, String(bad))
  }
})

test('rejects missing files, accepts existing ones', async () => {
  assert.equal(await checkOpenable('/definitely/not/here.txt'), 'File no longer exists')
  assert.equal(await checkOpenable(import.meta.filename), null)
})
