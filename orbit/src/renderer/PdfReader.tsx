import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { FileEntry } from '@shared/types'
import { Icon } from './Icons'
import { documentOptions, pdfjs } from './pdfjs'
import {
  canvasScale,
  clampPage,
  countPageMatches,
  fitWidthScale,
  hitAt,
  nextZoom,
  pageAt,
  pageOffsets,
  splitMatches,
  totalHits,
  visibleRange
} from './pdfText'

const GAP = 12
const SIDE = 24

interface Props {
  entry: FileEntry
  onClose: () => void
  onOpenExternal: (entry: FileEntry) => void
  /** Tells the copilot which page is showing. */
  onPage?: (page: number) => void
}

type Phase = 'loading' | 'ready' | 'error' | 'password'
interface Size {
  w: number
  h: number
}
interface Focus {
  nth: number
  nonce: number
}

/** Wraps matches in <mark> inside the text layer. Returns the marks in reading order. */
function applyHighlights(root: HTMLElement, query: string): HTMLElement[] {
  const marks: HTMLElement[] = []
  for (const span of root.querySelectorAll<HTMLElement>('span')) {
    const orig = span.dataset['orig'] ?? (span.dataset['orig'] = span.textContent ?? '')
    const segs = splitMatches(orig, query)
    if (segs.some((s) => s.hit)) {
      span.replaceChildren(
        ...segs.map((s) => {
          if (!s.hit) return document.createTextNode(s.text)
          const m = document.createElement('mark')
          m.textContent = s.text
          marks.push(m)
          return m
        })
      )
    } else if (span.firstElementChild) {
      span.textContent = orig // had highlights for an earlier search
    }
  }
  return marks
}

/** Scrolls the reader (and nothing else: scrollIntoView would also shift the app shell) so `el` is centred. */
function reveal(el: HTMLElement): void {
  const sc = el.closest<HTMLElement>('.pdf-scroll')
  if (!sc) return
  const a = el.getBoundingClientRect()
  const b = sc.getBoundingClientRect()
  sc.scrollTop += a.top + a.height / 2 - (b.top + b.height / 2)
  if (a.left < b.left + 20 || a.right > b.right - 20) sc.scrollLeft += a.left + a.width / 2 - (b.left + b.width / 2)
}

interface PageProps {
  doc: PDFDocumentProxy
  num: number
  scale: number
  w: number
  h: number
  top: number
  left: number
  query: string
  focus: Focus | null
  onSize: (num: number, size: Size) => void
}

const PageView = memo(function PageView({ doc, num, scale, w, h, top, left, query, focus, onSize }: PageProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [rendered, setRendered] = useState(0)
  const lastNonce = useRef(0)

  useEffect(() => {
    let cancelled = false
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null
    let layer: { cancel: () => void; render: () => Promise<unknown> } | null = null
    const canvas = canvasRef.current
    const text = textRef.current
    if (!canvas || !text) return
    ;(async () => {
      const page = await doc.getPage(num)
      if (cancelled) return
      const v1 = page.getViewport({ scale: 1 })
      onSize(num, { w: v1.width, h: v1.height })
      const vp = page.getViewport({ scale })
      const k = canvasScale(vp.width, vp.height, window.devicePixelRatio || 1)
      canvas.width = Math.floor(vp.width * k)
      canvas.height = Math.floor(vp.height * k)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      task = page.render({ canvasContext: ctx, viewport: vp, transform: k === 1 ? undefined : [k, 0, 0, k, 0, 0] })
      await task.promise
      if (cancelled) return
      text.replaceChildren()
      text.style.setProperty('--scale-factor', String(scale))
      layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport: vp })
      await layer.render()
      if (!cancelled) setRendered((n) => n + 1)
    })().catch((e: unknown) => {
      const name = (e as { name?: string } | null)?.name
      if (name !== 'RenderingCancelledException' && name !== 'AbortException') console.warn('PDF page failed', num, e)
    })
    return () => {
      cancelled = true
      task?.cancel()
      layer?.cancel()
      canvas.width = 0 // frees the bitmap of pages that scroll away
      canvas.height = 0
    }
  }, [doc, num, scale, onSize])

  // Highlights follow the search; the current hit is outlined and scrolled to the middle.
  useEffect(() => {
    const text = textRef.current
    if (!text || rendered === 0) return
    const marks = applyHighlights(text, query)
    for (const m of marks) m.classList.remove('cur')
    if (focus && focus.nonce !== lastNonce.current) {
      const m = marks[focus.nth]
      if (m) {
        lastNonce.current = focus.nonce
        m.classList.add('cur')
        reveal(m)
      }
    } else if (focus) {
      marks[focus.nth]?.classList.add('cur')
    }
  }, [rendered, query, focus])

  return (
    <div className="pdf-page" style={{ top, left, width: w, height: h }} data-page={num}>
      <canvas ref={canvasRef} style={{ width: w, height: h }} />
      <div ref={textRef} className="pdf-text" />
    </div>
  )
})

export default function PdfReader({ entry, onClose, onOpenExternal, onPage }: Props): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState('')
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pw, setPw] = useState<{ update: (p: string) => void; wrong: boolean } | null>(null)
  const [pwText, setPwText] = useState('')

  // ---- layout ----
  const [defaultSize, setDefaultSize] = useState<Size>({ w: 612, h: 792 })
  const sizes = useRef(new Map<number, Size>())
  const [layoutVer, setLayoutVer] = useState(0)
  const [view, setView] = useState({ w: 800, h: 600 })
  const [fit, setFit] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [page, setPage] = useState(1)
  const [range, setRange] = useState<[number, number]>([1, 3])
  const [pageInput, setPageInput] = useState('1')
  const numPages = doc?.numPages ?? 0

  const scale = fit ? fitWidthScale(view.w, defaultSize.w, SIDE * 2) : zoom

  const layout = useMemo(() => {
    const heights: number[] = []
    let maxW = defaultSize.w
    for (let i = 1; i <= numPages; i++) {
      const s = sizes.current.get(i) ?? defaultSize
      heights.push(s.h * scale)
      if (s.w > maxW) maxW = s.w
    }
    const { tops, total } = pageOffsets(heights, GAP)
    return { heights, tops, total, innerW: Math.max(view.w, maxW * scale + SIDE * 2) }
    // layoutVer is the signal that `sizes` changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages, scale, defaultSize, view.w, layoutVer])

  const onSize = useCallback((num: number, s: Size) => {
    const old = sizes.current.get(num)
    if (old && Math.abs(old.w - s.w) < 0.5 && Math.abs(old.h - s.h) < 0.5) return
    sizes.current.set(num, s)
    setLayoutVer((v) => v + 1)
  }, [])

  // ---- load ----
  useEffect(() => {
    let cancelled = false
    let task: ReturnType<typeof pdfjs.getDocument> | null = null
    setPhase('loading')
    setDoc(null)
    sizes.current.clear()
    ;(async () => {
      const res = await window.orbit.pdfBytes(entry.path)
      if (cancelled) return
      if (!res.ok) {
        setError(res.message)
        setPhase('error')
        return
      }
      task = pdfjs.getDocument({ data: res.data, ...documentOptions })
      task.onPassword = (update: (p: string) => void, reason: number) => {
        setPw({ update, wrong: reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD })
        setPhase('password')
      }
      const d = await task.promise
      if (cancelled) {
        void d.destroy()
        return
      }
      const first = await d.getPage(1)
      const v = first.getViewport({ scale: 1 })
      if (cancelled) return
      setDefaultSize({ w: v.width, h: v.height })
      setPw(null)
      setDoc(d)
      setPhase('ready')
    })().catch((e: unknown) => {
      if (cancelled) return
      const name = (e as { name?: string } | null)?.name
      setError(name === 'InvalidPDFException' ? 'This file is not a valid PDF, or it is damaged.' : ((e as Error)?.message ?? 'Could not open this PDF'))
      setPhase('error')
    })
    return () => {
      cancelled = true
      void task?.destroy()
    }
  }, [entry.path])

  // ---- scroll tracking ----
  const anchor = useRef({ page: 1, frac: 0 })
  const updateFromScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || layout.tops.length === 0) return
    const y = el.scrollTop
    const p = pageAt(layout.tops, y + el.clientHeight / 3)
    const top = layout.tops[p - 1] ?? 0
    const h = layout.heights[p - 1] ?? 1
    anchor.current = { page: p, frac: (y - top) / h }
    setPage((old) => (old === p ? old : p))
    setPageInput((old) => (document.activeElement === document.getElementById('pdf-page-input') ? old : String(p)))
    const r = visibleRange(layout.tops, layout.heights, y - 300, y + el.clientHeight + 300, 1)
    setRange((old) => (old[0] === r[0] && old[1] === r[1] ? old : r))
  }, [layout])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let raf = 0
    const onScroll = (): void => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        updateFromScroll()
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [updateFromScroll, phase])

  useEffect(() => updateFromScroll(), [updateFromScroll])

  // Keep the same spot on the page when the zoom changes.
  const prevScale = useRef(scale)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || prevScale.current === scale) return
    prevScale.current = scale
    const { page: p, frac } = anchor.current
    el.scrollTop = (layout.tops[p - 1] ?? 0) + frac * (layout.heights[p - 1] ?? 0)
  }, [scale, layout])

  // Track the visible area size.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setView({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setView({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [phase])

  const goTo = useCallback(
    (n: number) => {
      const el = scrollRef.current
      if (!el || numPages === 0) return
      const p = clampPage(n, numPages)
      el.scrollTop = Math.max(0, (layout.tops[p - 1] ?? 0) - GAP)
    },
    [layout, numPages]
  )

  const zoomBy = useCallback(
    (dir: 1 | -1) => {
      setFit(false)
      setZoom(nextZoom(fit ? scale : zoom, dir))
    },
    [fit, scale, zoom]
  )

  // ---- search ----
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [counts, setCounts] = useState<number[]>([])
  const [scanned, setScanned] = useState(0)
  const [cur, setCur] = useState(-1)
  const [focus, setFocus] = useState<Focus | null>(null)
  const nonce = useRef(0)
  const lines = useRef(new Map<number, string[]>())

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    lines.current.clear()
  }, [doc])

  useEffect(() => {
    setCounts([])
    setScanned(0)
    setCur(-1)
    setFocus(null)
    if (!doc || !query) return
    let cancelled = false
    ;(async () => {
      const acc: number[] = []
      for (let p = 1; p <= doc.numPages; p++) {
        let ls = lines.current.get(p)
        if (!ls) {
          const pg = await doc.getPage(p)
          const tc = await pg.getTextContent()
          ls = tc.items.map((i) => ('str' in i ? i.str : ''))
          lines.current.set(p, ls)
        }
        if (cancelled) return
        acc[p - 1] = countPageMatches(ls, query)
        if (p % 8 === 0 || p === doc.numPages) {
          setCounts([...acc])
          setScanned(p)
        }
      }
    })().catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [doc, query])

  const total = totalHits(counts)
  const scanning = !!query && !!doc && scanned < doc.numPages

  const jumpTo = useCallback(
    (index: number) => {
      const h = hitAt(counts, index)
      if (!h) return
      setCur(index)
      nonce.current += 1
      setFocus({ nth: h.nth, nonce: nonce.current })
      goTo(h.page)
    },
    [counts, goTo]
  )

  // First hit: jump there as soon as it is known.
  useEffect(() => {
    if (cur < 0 && total > 0) jumpTo(0)
  }, [cur, total, jumpTo])

  const step = useCallback(
    (dir: 1 | -1) => {
      if (total === 0) return
      jumpTo((((cur < 0 ? (dir === 1 ? -1 : 0) : cur) + dir) % total + total) % total)
    },
    [cur, total, jumpTo]
  )

  // ---- keyboard ----
  useEffect(() => {
    rootRef.current?.focus()
  }, [phase])

  useEffect(() => {
    onPage?.(page)
  }, [page, onPage])

  const key = useRef<(e: KeyboardEvent) => void>(() => undefined)
  key.current = (e: KeyboardEvent): void => {
    if (e.target instanceof Element && e.target.closest('.aipanel')) return // typing in the copilot is not for the reader
    const inField = e.target instanceof HTMLInputElement
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      if (inField) rootRef.current?.focus()
      else onClose()
      return
    }
    if (e.key === 'F3') {
      e.preventDefault()
      step(e.shiftKey ? -1 : 1)
      return
    }
    if (inField) return
    if (e.target instanceof HTMLButtonElement && (e.key === ' ' || e.key === 'Enter')) return // let the button work
    const el = scrollRef.current
    switch (e.key) {
      case 'PageDown':
      case ' ':
        e.preventDefault()
        el?.scrollBy({ top: (el.clientHeight || 600) * 0.9 })
        break
      case 'PageUp':
        e.preventDefault()
        el?.scrollBy({ top: -(el.clientHeight || 600) * 0.9 })
        break
      case 'ArrowDown':
        e.preventDefault()
        el?.scrollBy({ top: 60 })
        break
      case 'ArrowUp':
        e.preventDefault()
        el?.scrollBy({ top: -60 })
        break
      case 'Home':
        e.preventDefault()
        goTo(1)
        break
      case 'End':
        e.preventDefault()
        goTo(numPages)
        break
      case '+':
      case '=':
        e.preventDefault()
        zoomBy(1)
        break
      case '-':
        e.preventDefault()
        zoomBy(-1)
        break
      case '0':
        e.preventDefault()
        setFit(true)
        break
      default:
    }
  }
  useEffect(() => {
    const h = (e: KeyboardEvent): void => key.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // Ctrl + wheel zooms (needs a non-passive listener to stop the page itself from zooming).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      zoomBy(e.deltaY < 0 ? 1 : -1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomBy, phase])

  // ---- render ----
  const pages: JSX.Element[] = []
  if (doc) {
    for (let n = range[0]; n <= Math.min(range[1], numPages); n++) {
      const w = (sizes.current.get(n) ?? defaultSize).w * scale
      pages.push(
        <PageView
          key={n}
          doc={doc}
          num={n}
          scale={scale}
          w={w}
          h={layout.heights[n - 1] ?? 0}
          top={layout.tops[n - 1] ?? 0}
          left={(layout.innerW - w) / 2}
          query={query}
          focus={focus && hitAt(counts, cur)?.page === n ? focus : null}
          onSize={onSize}
        />
      )
    }
  }

  const submitPassword = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!pw) return
    pw.update(pwText)
    setPwText('')
  }

  return (
    <div className="pdfreader" ref={rootRef} tabIndex={-1} role="dialog" aria-label={`PDF reader: ${entry.name}`}>
      <div className="pdf-bar">
        <button className="iconbtn" onClick={onClose} title="Close (Esc)">
          <Icon name="close" size={18} />
        </button>
        <div className="pdf-title" title={entry.path}>
          {entry.name}
        </div>

        <div className="pdf-group" aria-label="Pages">
          <button className="iconbtn small" disabled={page <= 1} onClick={() => goTo(page - 1)} title="Previous page">
            <Icon name="up" size={15} />
          </button>
          <input
            id="pdf-page-input"
            className="pdf-page-input"
            value={pageInput}
            inputMode="numeric"
            aria-label="Page number"
            onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                goTo(Number(pageInput) || 1)
                rootRef.current?.focus()
              }
            }}
            onBlur={() => setPageInput(String(page))}
          />
          <span className="muted">/ {numPages || '–'}</span>
          <button className="iconbtn small" disabled={page >= numPages} onClick={() => goTo(page + 1)} title="Next page">
            <Icon name="up" size={15} className="flip" />
          </button>
        </div>

        <div className="pdf-group" aria-label="Zoom">
          <button className="iconbtn small" onClick={() => zoomBy(-1)} title="Zoom out (-)">
            <span className="pdf-sym">−</span>
          </button>
          <button className={`pdf-zoom${fit ? ' on' : ''}`} onClick={() => setFit(true)} title="Fit to width (0)">
            {Math.round(scale * 100)}%
          </button>
          <button className="iconbtn small" onClick={() => zoomBy(1)} title="Zoom in (+)">
            <span className="pdf-sym">+</span>
          </button>
        </div>

        <div className="pdf-search">
          <Icon name="search" size={14} />
          <input
            ref={searchRef}
            value={q}
            placeholder="Search in PDF"
            aria-label="Search in PDF"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (q.trim() !== query) setQuery(q.trim())
                else step(e.shiftKey ? -1 : 1)
              }
            }}
          />
          {query && (
            <span className="pdf-count" aria-live="polite">
              {total === 0 ? (scanning ? 'Searching…' : 'No matches') : `${cur + 1} of ${total}${scanning ? '+' : ''}`}
            </span>
          )}
          <button className="iconbtn small" disabled={total === 0} onClick={() => step(-1)} title="Previous match (Shift+Enter)">
            <Icon name="up" size={14} />
          </button>
          <button className="iconbtn small" disabled={total === 0} onClick={() => step(1)} title="Next match (Enter)">
            <Icon name="up" size={14} className="flip" />
          </button>
        </div>

        <button className="ql-open" onClick={() => onOpenExternal(entry)} title="Open in the default app">
          Open externally
        </button>
      </div>

      {phase === 'loading' && <div className="pdf-msg">Opening…</div>}
      {phase === 'error' && (
        <div className="pdf-msg">
          <Icon name="file" size={48} className="ic k-pdf" />
          <p>{error}</p>
          <button className="ql-open" onClick={() => onOpenExternal(entry)}>
            Open in default app
          </button>
        </div>
      )}
      {phase === 'password' && (
        <form className="pdf-msg" onSubmit={submitPassword}>
          <Icon name="file" size={48} className="ic k-pdf" />
          <p>{pw?.wrong ? 'That password is not right. Try again.' : 'This PDF is password protected.'}</p>
          <input
            type="password"
            autoFocus
            className="pdf-pw"
            value={pwText}
            placeholder="Password"
            aria-label="PDF password"
            onChange={(e) => setPwText(e.target.value)}
          />
          <button className="ql-open" type="submit">
            Unlock
          </button>
        </form>
      )}
      {phase === 'ready' && (
        <div className="pdf-scroll" ref={scrollRef}>
          <div className="pdf-pages" style={{ height: layout.total, width: layout.innerW }}>
            {pages}
          </div>
        </div>
      )}
    </div>
  )
}
