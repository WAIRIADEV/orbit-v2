import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mediaUrl, pathFromMediaUrl, thumbUrl } from './mediaUrl.ts'

test('file and thumb URLs round-trip, including odd characters', () => {
  const p = 'C:\\Users\\Tony\\Pictures\\a b #1 & é.png'
  assert.equal(pathFromMediaUrl(mediaUrl(p)), p)
  assert.equal(pathFromMediaUrl(thumbUrl(p, 1234.9), 'thumb'), p)
})

test('hosts are not interchangeable and bad paths are refused', () => {
  assert.equal(pathFromMediaUrl(thumbUrl('/a/b.png', 1)), null)
  assert.equal(pathFromMediaUrl(mediaUrl('/a/b.png'), 'thumb'), null)
  assert.equal(pathFromMediaUrl('orbit-media://file/relative.png'), null)
  assert.equal(pathFromMediaUrl('http://file/%2Fa'), null)
})

test('thumb URL carries the version', () => {
  assert.ok(thumbUrl('/a.png', 99.7).endsWith('?v=99'))
})
