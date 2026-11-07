// Pure helpers for the PDF reader: no React, no pdf.js, so they are unit-tested.

export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const
export const MIN_ZOOM = ZOOM_STEPS[0]
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]!

/** The next zoom step above or below `current` (works from any value, e.g. after "fit width"). */
export function nextZoom(current: number, dir: 1 | -1): number {
  if (dir === 1) return ZOOM_STEPS.find((z) => z > current + 0.001) ?? MAX_ZOOM
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    const z = ZOOM_STEPS[i]!
    if (z < current - 0.001) return z
  }
  return MIN_ZOOM
}

export function clampPage(n: number, total: number): number {
  if (!Number.isFinite(n) || total < 1) return 1
  return Math.min(Math.max(Math.round(n), 1), total)
}

/** Scale that makes a page of `pageWidth` fill `viewWidth` minus padding, within the zoom limits. */
export function fitWidthScale(viewWidth: number, pageWidth: number, padding = 48): number {
  if (pageWidth <= 0 || viewWidth <= 0) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (viewWidth - padding) / pageWidth))
}

export interface Segment {
  text: string
  hit: boolean
}

/** Splits `text` around case-insensitive matches of `query`. An empty query gives one plain segment. */
export function splitMatches(text: string, query: string): Segment[] {
  const q = query.trim().toLowerCase()
  if (!q || !text) return [{ text, hit: false }]
  const hay = text.toLowerCase()
  const out: Segment[] = []
  let from = 0
  for (;;) {
    const at = hay.indexOf(q, from)
    if (at < 0) break
    if (at > from) out.push({ text: text.slice(from, at), hit: false })
    out.push({ text: text.slice(at, at + q.length), hit: true })
    from = at + q.length
  }
  if (from < text.length) out.push({ text: text.slice(from), hit: false })
  return out.length > 0 ? out : [{ text, hit: false }]
}

export function countMatches(text: string, query: string): number {
  return splitMatches(text, query).filter((s) => s.hit).length
}

/** Matches in one page, counted line by line (the same way they are highlighted). */
export function countPageMatches(lines: readonly string[], query: string): number {
  let n = 0
  for (const l of lines) n += countMatches(l, query)
  return n
}

export interface Hit {
  page: number
  /** Which match on that page (0-based), in reading order. */
  nth: number
}

/** Turns per-page match counts into the hit at global position `index`. */
export function hitAt(counts: ReadonlyArray<number>, index: number): Hit | null {
  if (index < 0) return null
  let left = index
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i] ?? 0
    if (left < c) return { page: i + 1, nth: left }
    left -= c
  }
  return null
}

export function totalHits(counts: ReadonlyArray<number>): number {
  let n = 0
  for (const c of counts) n += c
  return n
}

/** Joins the text items of a page into readable text; used for search and, later, for the AI. */
export function joinPageText(items: ReadonlyArray<{ str: string; hasEOL?: boolean }>): string {
  let out = ''
  for (const it of items) out += it.hasEOL ? `${it.str}\n` : it.str
  return out.replace(/[ \t]+\n/g, '\n').trim()
}

/** Top offset of each page in a column with `gap` between pages, plus the total height. */
export function pageOffsets(heights: ReadonlyArray<number>, gap: number): { tops: number[]; total: number } {
  const tops: number[] = []
  let y = gap
  for (const h of heights) {
    tops.push(y)
    y += h + gap
  }
  return { tops, total: y }
}

/** 1-based page that contains the vertical position `y` (the page whose area, or the gap after it, holds y). */
export function pageAt(tops: ReadonlyArray<number>, y: number): number {
  if (tops.length === 0) return 1
  let lo = 0
  let hi = tops.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (tops[mid]! <= y) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

/** Pages to mount: those intersecting [top, bottom] plus `extra` pages either side. */
export function visibleRange(tops: ReadonlyArray<number>, heights: ReadonlyArray<number>, top: number, bottom: number, extra = 1): [number, number] {
  if (tops.length === 0) return [1, 0]
  const first = pageAt(tops, top)
  let last = first
  while (last < tops.length && tops[last]! < bottom) last++ // tops[last] is page last+1
  return [Math.max(1, first - extra), Math.min(tops.length, last + extra)]
}

/** Pixel density to draw a page canvas at: the screen's, reduced so one canvas never exceeds `maxPixels`. */
export function canvasScale(cssW: number, cssH: number, dpr: number, maxPixels = 16_000_000): number {
  const want = Math.max(1, dpr)
  const area = cssW * cssH * want * want
  if (area <= maxPixels || cssW <= 0 || cssH <= 0) return want
  return Math.max(0.5, Math.sqrt(maxPixels / (cssW * cssH)))
}
