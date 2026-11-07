import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampPage, countMatches, countPageMatches, fitWidthScale, hitAt, joinPageText, nextZoom, pageAt, pageOffsets, splitMatches, totalHits, visibleRange } from './pdfText.ts'

test('nextZoom steps through the ladder from any starting value', () => {
  assert.equal(nextZoom(1, 1), 1.25)
  assert.equal(nextZoom(1, -1), 0.75)
  assert.equal(nextZoom(1.1, 1), 1.25) // after "fit width" gave 1.1
  assert.equal(nextZoom(1.1, -1), 1)
  assert.equal(nextZoom(4, 1), 4)
  assert.equal(nextZoom(0.5, -1), 0.5)
})

test('clampPage and fitWidthScale stay in range', () => {
  assert.equal(clampPage(0, 10), 1)
  assert.equal(clampPage(99, 10), 10)
  assert.equal(clampPage(3.6, 10), 4)
  assert.equal(clampPage(NaN, 10), 1)
  assert.equal(clampPage(5, 0), 1)
  assert.equal(fitWidthScale(648, 600), 1)
  assert.equal(fitWidthScale(100000, 600), 4)
  assert.equal(fitWidthScale(60, 600), 0.5)
  assert.equal(fitWidthScale(0, 600), 1)
})

test('splitMatches: case-insensitive, keeps original casing, handles edges', () => {
  assert.deepEqual(splitMatches('Pay the Payment', 'pay'), [
    { text: 'Pay', hit: true },
    { text: ' the ', hit: false },
    { text: 'Pay', hit: true },
    { text: 'ment', hit: false }
  ])
  assert.deepEqual(splitMatches('abc', ''), [{ text: 'abc', hit: false }])
  assert.deepEqual(splitMatches('abc', '   '), [{ text: 'abc', hit: false }])
  assert.deepEqual(splitMatches('abc', 'x'), [{ text: 'abc', hit: false }])
  assert.deepEqual(splitMatches('', 'x'), [{ text: '', hit: false }])
  assert.equal(countMatches('aaaa', 'aa'), 2) // non-overlapping
  assert.equal(countPageMatches(['total', 'Totals', 'x'], 'total'), 2)
})

test('hitAt maps a global index to page + nth', () => {
  const counts = [2, 0, 3]
  assert.deepEqual(hitAt(counts, 0), { page: 1, nth: 0 })
  assert.deepEqual(hitAt(counts, 1), { page: 1, nth: 1 })
  assert.deepEqual(hitAt(counts, 2), { page: 3, nth: 0 })
  assert.deepEqual(hitAt(counts, 4), { page: 3, nth: 2 })
  assert.equal(hitAt(counts, 5), null)
  assert.equal(hitAt(counts, -1), null)
  assert.equal(totalHits(counts), 5)
})

test('joinPageText keeps line breaks and trims trailing spaces', () => {
  assert.equal(joinPageText([{ str: 'Hello ' }, { str: 'world', hasEOL: true }, { str: 'Second line', hasEOL: true }]), 'Hello world\nSecond line')
  assert.equal(joinPageText([{ str: 'a ', hasEOL: true }, { str: 'b' }]), 'a\nb')
  assert.equal(joinPageText([]), '')
})

test('page layout: offsets, page-at-position and the mounted range', () => {
  const heights = [100, 100, 200, 100]
  const { tops, total } = pageOffsets(heights, 10)
  assert.deepEqual(tops, [10, 120, 230, 440])
  assert.equal(total, 550)
  assert.equal(pageAt(tops, 0), 1)
  assert.equal(pageAt(tops, 119), 1)
  assert.equal(pageAt(tops, 120), 2)
  assert.equal(pageAt(tops, 500), 4)
  assert.deepEqual(visibleRange(tops, heights, 0, 90, 0), [1, 1])
  assert.deepEqual(visibleRange(tops, heights, 0, 90, 1), [1, 2])
  assert.deepEqual(visibleRange(tops, heights, 130, 300, 0), [2, 3])
  assert.deepEqual(visibleRange(tops, heights, 130, 300, 1), [1, 4])
  assert.deepEqual(visibleRange([], [], 0, 100), [1, 0])
})

import { canvasScale } from './pdfText.ts'

test('canvasScale: full density normally, capped for huge pages', () => {
  assert.equal(canvasScale(612, 792, 2), 2)
  assert.equal(canvasScale(612, 792, 0.5), 1) // never below 1:1 for normal pages
  const s = canvasScale(612 * 4, 792 * 4, 2) // zoom 4x on a 2x screen
  assert.ok(s < 2 && s >= 0.5)
  assert.ok(612 * 4 * s * 792 * 4 * s <= 16_000_000 + 1)
  assert.equal(canvasScale(0, 0, 2), 2)
})
