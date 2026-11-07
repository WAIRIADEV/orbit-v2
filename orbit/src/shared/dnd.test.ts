import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dropVerdict, isInside, samePath } from './dnd.ts'
import { ACCENTS, contrastRatio, findAccent, onAccent } from './accents.ts'
import { mediaUrl, pathFromMediaUrl } from './mediaUrl.ts'

test('samePath ignores case and slash style on Windows paths only', () => {
  assert.equal(samePath('C:\\Users\\Tony\\', 'c:/users/tony'), true)
  assert.equal(samePath('/home/Tony', '/home/tony'), false)
  assert.equal(samePath('C:\\', 'c:'), true)
})

test('isInside is strict and respects folder boundaries', () => {
  assert.equal(isInside('C:\\a\\b', 'C:\\a'), true)
  assert.equal(isInside('C:\\a', 'C:\\a'), false)
  assert.equal(isInside('C:\\ab', 'C:\\a'), false) // "ab" is not inside "a"
  assert.equal(isInside('C:\\a', 'C:\\'), true)
  assert.equal(isInside('/x/y', '/'), true)
})

test('dropVerdict: moving back into the same folder is refused, copying is allowed', () => {
  const src = ['C:\\Docs\\a.txt']
  assert.equal(dropVerdict(src, 'C:\\Docs', false), 'same-folder')
  assert.equal(dropVerdict(src, 'C:\\Docs', true), 'ok')
  assert.equal(dropVerdict(src, 'C:\\Other', false), 'ok')
})

test('dropVerdict: a folder can never go into itself or its own subfolder', () => {
  assert.equal(dropVerdict(['C:\\Docs'], 'C:\\Docs', false), 'into-self')
  assert.equal(dropVerdict(['C:\\Docs'], 'C:\\Docs\\Sub', true), 'into-self')
  assert.equal(dropVerdict(['C:\\Docs', 'C:\\Pics'], 'C:\\Pics\\x', false), 'into-self')
  assert.equal(dropVerdict([], 'C:\\x', false), 'nothing')
})

test('dropVerdict: mixed selection is ok if at least one item really moves', () => {
  assert.equal(dropVerdict(['C:\\A\\1.txt', 'C:\\B\\2.txt'], 'C:\\A', false), 'ok')
})

test('mediaUrl round-trips awkward Windows and POSIX paths', () => {
  for (const p of ['C:\\Users\\Tony\\My Photos\\a#1 (final).png', 'D:\\ünï\\日本語.mp4', '/home/t/a b/c%20d.mp3']) {
    assert.equal(pathFromMediaUrl(mediaUrl(p)), p)
  }
})

test('pathFromMediaUrl rejects other schemes, relative paths and garbage', () => {
  assert.equal(pathFromMediaUrl('https://file/C%3A%5Ca.png'), null)
  assert.equal(pathFromMediaUrl('orbit-media://evil/C%3A%5Ca.png'), null)
  assert.equal(pathFromMediaUrl('orbit-media://file/..%2F..%2Fetc%2Fpasswd'), null)
  assert.equal(pathFromMediaUrl('orbit-media://file/'), null)
  assert.equal(pathFromMediaUrl('not a url'), null)
})

test('every accent is readable: button text >= 4.5:1 and the accent itself >= 3:1 on its surface', () => {
  const surfaces = { dark: '#1c1c22', light: '#fcfcff' } as const
  for (const a of ACCENTS) {
    for (const theme of ['dark', 'light'] as const) {
      const colour = a[theme]
      assert.ok(contrastRatio(colour, onAccent(colour)) >= 4.5, `${a.id}/${theme}: text on accent`)
      assert.ok(contrastRatio(colour, surfaces[theme]) >= 3, `${a.id}/${theme}: accent on surface`)
    }
  }
})

test('findAccent falls back to the default for unknown ids', () => {
  assert.equal(findAccent('teal').id, 'teal')
  assert.equal(findAccent('nope').id, 'indigo')
  assert.equal(findAccent(null).id, 'indigo')
})
