import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { opActiveText, opDoneText } from './opText'
import type { AiContext, AiPlan, DriveInfo, FileEntry, OpProgress, Place, ThemeMode } from '@shared/types'
import { planToRequests } from '@shared/aiPlan'
import { dropVerdict } from '@shared/dnd'
import { DEFAULT_ACCENT, findAccent, onAccent } from '@shared/accents'
import { pushRecent, type Recent } from '@shared/recents'
import { Pane, type PaneHandle, type PaneId, type PaneStats } from './Pane'
import { Monitor } from './Monitor'
import { QuickLook } from './QuickLook'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { TitleBar } from './TitleBar'
import { load, save } from './storage'

// The PDF engine is large, so it is only fetched the first time a PDF is opened.
const PdfReader = lazy(() => import('./PdfReader'))
const AiPanel = lazy(() => import('./AiPanel'))

const noop = (): void => undefined // a module-level function keeps the memoized panes from re-rendering

const EMPTY_STATS: PaneStats = { path: null, listMs: null, total: 0, shown: 0, selected: 0, deep: null, bin: null }

function statsEqual(a: PaneStats, b: PaneStats): boolean {
  return (
    a.path === b.path &&
    a.listMs === b.listMs &&
    a.total === b.total &&
    a.shown === b.shown &&
    a.selected === b.selected &&
    a.bin === b.bin &&
    a.deep?.running === b.deep?.running &&
    a.deep?.count === b.deep?.count &&
    a.deep?.limited === b.deep?.limited &&
    (a.deep === null) === (b.deep === null)
  )
}

function storedTheme(): ThemeMode | null {
  const t = load<string | null>('orbit.theme', null)
  return t === 'light' || t === 'dark' ? t : null
}

interface Note {
  text: string
  error: boolean
}

interface ClipboardItem {
  mode: 'copy' | 'cut'
  paths: string[]
}

export function App(): JSX.Element {
  const [theme, setTheme] = useState<ThemeMode>(() => storedTheme() ?? 'dark')
  const [accent, setAccent] = useState<string>(() => findAccent(load<string>('orbit.accent', DEFAULT_ACCENT)).id)
  const [dual, setDual] = useState<boolean>(() => load<boolean>('orbit.dual', false) === true)
  const [activeId, setActiveId] = useState<PaneId>('left')
  const [places, setPlaces] = useState<Place[]>([])
  const [drives, setDrives] = useState<DriveInfo[]>([])
  const [recents, setRecents] = useState<Recent[]>(() => load<Recent[]>('orbit.recents', []))
  const [quickLook, setQuickLook] = useState(false)
  const [focus, setFocus] = useState<FileEntry | null>(null)
  const [stats, setStats] = useState<Record<PaneId, PaneStats>>({ left: EMPTY_STATS, right: EMPTY_STATS })
  const [refreshTick, setRefreshTick] = useState(0)
  const [op, setOp] = useState<OpProgress | null>(null)
  const [note, setNote] = useState<Note | null>(null)
  const [clipCount, setClipCount] = useState(0)
  const [monitor, setMonitor] = useState(false)
  const [reader, setReader] = useState<FileEntry | null>(null)
  const readerRef = useRef(reader)
  readerRef.current = reader
  const [readerPage, setReaderPage] = useState(1)
  const readerPageRef = useRef(1)
  readerPageRef.current = readerPage
  const [aiOpen, setAiOpen] = useState<boolean>(() => load<boolean>('orbit.ai', false) === true)

  // With a single pane the left one is always the active one.
  const active: PaneId = dual ? activeId : 'left'

  const leftRef = useRef<PaneHandle>(null)
  const rightRef = useRef<PaneHandle>(null)
  const clipboard = useRef<ClipboardItem | null>(null)
  const recentsRef = useRef(recents)
  const statsRef = useRef(stats)
  const activeRef = useRef(active)
  const dualRef = useRef(dual)
  statsRef.current = stats
  activeRef.current = active
  dualRef.current = dual

  const handleOf = (id: PaneId): PaneHandle | null => (id === 'left' ? leftRef.current : rightRef.current)
  const say = useCallback((text: string, error = false) => setNote({ text, error }), [])

  // ---------- theme + accent ----------

  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset['theme'] = theme
    const a = findAccent(accent)
    const color = theme === 'dark' ? a.dark : a.light
    root.style.setProperty('--accent', color)
    root.style.setProperty('--on-accent', onAccent(color))
    window.orbit.setTheme(theme)
  }, [theme, accent])

  // First launch only: follow the system theme until the user picks one.
  useEffect(() => {
    if (storedTheme() === null) void window.orbit.systemTheme().then(setTheme)
  }, [])

  const toggleTheme = useCallback(() => {
    const next: ThemeMode = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    save('orbit.theme', next)
  }, [theme])

  const chooseAccent = useCallback((id: string) => {
    const next = findAccent(id).id
    setAccent(next)
    save('orbit.accent', next)
  }, [])

  const toggleDual = useCallback(() => {
    const next = !dual
    setDual(next)
    save('orbit.dual', next)
    if (!next) setActiveId('left')
  }, [dual])

  // ---------- startup data ----------

  useEffect(() => {
    void window.orbit.places().then(setPlaces)
  }, [])

  // Drives are polled every 5 s (cheap) so plugging in a USB stick shows up without a restart.
  useEffect(() => {
    let alive = true
    let last = ''
    const tick = async (): Promise<void> => {
      if (document.hidden) return
      const next = await window.orbit.drives()
      const key = JSON.stringify(next)
      if (alive && key !== last) {
        last = key
        setDrives(next)
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 5000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  // ---------- file operations ----------

  useEffect(() => {
    return window.orbit.onOpProgress((p) => {
      setOp(p)
      if (p.status === 'done') {
        setRefreshTick((t) => t + 1) // every pane reloads: either one may show the folder that changed
        setNote(null)
        const done = opDoneText(p)
        if (done) say(done)
      } else if (p.status === 'cancelled') {
        setRefreshTick((t) => t + 1)
        const msg = opDoneText(p)
        if (msg) say(msg)
      } else if (p.status === 'failed') {
        say(p.error ?? 'Operation failed', true)
      }
    })
  }, [say])

  const runTransfer = useCallback(
    (paths: string[], targetDir: string, copy: boolean) => {
      const verdict = dropVerdict(paths, targetDir, copy)
      if (verdict === 'into-self') return say("A folder can't be placed inside itself", true)
      if (verdict === 'same-folder') return say('Those items are already in that folder')
      if (verdict !== 'ok') return
      void window.orbit.enqueue({ kind: copy ? 'copy' : 'move', sources: paths, target: targetDir })
    },
    [say]
  )

  const onClipboard = useCallback(
    (mode: 'copy' | 'cut', paths: string[]) => {
      clipboard.current = { mode, paths }
      setClipCount(paths.length)
      say(`${mode === 'copy' ? 'Copied' : 'Cut'} ${paths.length} item${paths.length > 1 ? 's' : ''}`)
    },
    [say]
  )

  const onPaste = useCallback(
    (targetDir: string) => {
      const clip = clipboard.current
      if (!clip) return
      runTransfer(clip.paths, targetDir, clip.mode === 'copy')
      if (clip.mode === 'cut') {
        clipboard.current = null
        setClipCount(0)
      }
    },
    [runTransfer]
  )

  const onTrash = useCallback((paths: string[]) => {
    void window.orbit.enqueue({ kind: 'trash', sources: paths })
  }, [])

  const onRename = useCallback((path: string, newName: string) => {
    void window.orbit.enqueue({ kind: 'rename', sources: [path], target: newName })
  }, [])

  const onUndo = useCallback(() => {
    void window.orbit.undo().then((r) => {
      say(r.message, !r.ok)
      if (r.ok) setRefreshTick((t) => t + 1)
    })
  }, [say])

  // ---------- panes ----------

  const onActivate = useCallback((id: PaneId) => {
    if (dualRef.current || id === 'left') setActiveId(id)
  }, [])

  const onNavigated = useCallback((path: string) => {
    const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
    const next = pushRecent(recentsRef.current, { path, name, isDir: true, ts: Date.now() })
    recentsRef.current = next
    setRecents(next)
    save('orbit.recents', next)
  }, [])

  const onStats = useCallback((id: PaneId, s: PaneStats) => {
    setStats((prev) => (statsEqual(prev[id], s) ? prev : { ...prev, [id]: s }))
  }, [])

  const onSwitchPane = useCallback(() => {
    if (!dualRef.current) return
    const to: PaneId = activeRef.current === 'left' ? 'right' : 'left'
    setActiveId(to)
    handleOf(to)?.focusList()
  }, [])

  const openFile = useCallback(
    (entry: FileEntry) => {
      void window.orbit.openPath(entry.path).then((err) => {
        if (err) say(`Couldn't open ${entry.name}: ${err}`, true)
      })
    },
    [say]
  )
  const onOpenInOther = useCallback((from: PaneId, path: string) => {
    handleOf(from === 'left' ? 'right' : 'left')?.open(path)
  }, [])

  const closeMonitor = useCallback(() => setMonitor(false), [])
  const openPdf = useCallback((entry: FileEntry) => {
    setReaderPage(1)
    setReader(entry)
  }, [])
  const closeReader = useCallback(() => setReader(null), [])

  // ---------- copilot ----------
  const toggleAi = useCallback(() => {
    setAiOpen((o) => {
      save('orbit.ai', !o)
      return !o
    })
  }, [])
  const openAi = useCallback(() => {
    setAiOpen(true)
    save('orbit.ai', true)
  }, [])
  const openMonitor = useCallback(() => setMonitor(true), [])
  const closeAi = useCallback(() => {
    setAiOpen(false)
    save('orbit.ai', false)
  }, [])
  /** What the copilot may see: read when a question is sent, so it is never stale. */
  const getAiContext = useCallback((): AiContext => {
    const id = activeRef.current
    const st = statsRef.current[id]
    const otherId: PaneId = id === 'left' ? 'right' : 'left'
    const r = readerRef.current
    return {
      cwd: st.bin !== null ? null : st.path,
      otherPane: dualRef.current ? statsRef.current[otherId].path : null,
      selected: st.selected > 0 ? (handleOf(id)?.targets() ?? []) : [],
      pdf: r ? { path: r.path, page: readerPageRef.current } : null
    }
    // handleOf only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const applyPlan = useCallback((plan: AiPlan) => {
    for (const req of planToRequests(plan)) void window.orbit.enqueue(req) // the queue runs them in order
  }, [])

  const toggleQuickLook = useCallback(() => setQuickLook((q) => !q), [])
  const closeQuickLook = useCallback(() => setQuickLook(false), [])
  const onFocusEntry = useCallback((_id: PaneId, entry: FileEntry | null) => setFocus(entry), [])

  // Ctrl+F: search box of the active pane.  F6: move to the other pane.  Shift+F5: copy to the other pane.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        toggleAi()
        return
      }
      if (e.target instanceof Element && e.target.closest('.aipanel')) return // typing in the copilot
      if (readerRef.current) return // the PDF reader owns the keyboard while it is open
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        handleOf(activeRef.current)?.focusSearch()
        return
      }
      const copy = e.key === 'F5' && e.shiftKey
      const move = e.key === 'F6'
      if (!copy && !move) return
      e.preventDefault()
      e.stopPropagation()
      if (!dualRef.current) return say('Turn on dual pane to copy or move between panes')
      const from = activeRef.current
      const dest = statsRef.current[from === 'left' ? 'right' : 'left'].path
      if (!dest) return say('Open a folder in the other pane first')
      const paths = handleOf(from)?.targets() ?? []
      if (paths.length > 0) runTransfer(paths, dest, copy)
    }
    window.addEventListener('keydown', handler, true) // capture: runs before the list's own handler
    return () => window.removeEventListener('keydown', handler, true)
  }, [runTransfer, say])

  // ---------- status bar ----------

  const s = stats[active]
  const opActive = !!op && (op.status === 'queued' || op.status === 'running')
  const summary =
    s.bin !== null
      ? s.bin < 0
        ? 'Recycle Bin'
        : `${s.bin.toLocaleString()} ${s.bin === 1 ? 'item' : 'items'} in the Recycle Bin`
      : s.path === null
      ? `${drives.length} ${drives.length === 1 ? 'drive' : 'drives'}`
      : `${s.shown.toLocaleString()} ${s.shown === 1 ? 'item' : 'items'}` +
        (!s.deep && s.shown !== s.total ? ` of ${s.total.toLocaleString()}` : '') +
        (s.selected > 0 ? ` · ${s.selected.toLocaleString()} selected` : '')

  const paneProps = {
    canSwitch: dual,
    places,
    drives,
    recents,
    refreshTick,
    quickLookOpen: quickLook,
    onActivate,
    onPathChange: noop,
    onNavigated,
    onStats,
    onFocusEntry,
    onToggleQuickLook: toggleQuickLook,
    onCloseQuickLook: closeQuickLook,
    onClipboard,
    onPaste,
    onUndo,
    onTrash,
    onRename,
    onTransfer: runTransfer,
    onSwitchPane,
    onMessage: say,
    onOpenPdf: openPdf,
    onCopilot: openAi,
    onMonitor: openMonitor,
    clipCount,
    onOpenInOther
  }

  return (
    <div className="shell">
      <TitleBar
        theme={theme}
        onToggleTheme={toggleTheme}
        accent={accent}
        onAccent={chooseAccent}
        dual={dual}
        onToggleDual={toggleDual}
      />

      <Sidebar
        places={places}
        drives={drives}
        current={monitor ? '\0' : s.path}
        onOpen={(p) => {
          setMonitor(false)
          handleOf(active)?.open(p)
        }}
        onHome={() => {
          setMonitor(false)
          handleOf(active)?.showHome()
        }}
        onBin={() => {
          setMonitor(false)
          handleOf(active)?.openBin()
        }}
        binActive={!monitor && s.bin !== null}
        monitorActive={monitor}
        onMonitor={() => setMonitor((m) => !m)}
        aiActive={aiOpen}
        onAi={toggleAi}
      />

      <main className="content">
        <div className="work">
          <div className={`panes${dual ? ' dual' : ''}`}>
            <Pane ref={leftRef} id="left" active={active === 'left'} initialPath={null} {...paneProps} />
            {dual && (
              <Pane
                ref={rightRef}
                id="right"
                active={active === 'right'}
                // The second pane starts in the folder the first one is showing.
                initialPath={stats.left.path ?? places[0]?.path ?? null}
                {...paneProps}
              />
            )}
          </div>

          {monitor && <Monitor drives={drives} onClose={closeMonitor} />}
          {quickLook && <QuickLook entry={focus} onClose={closeQuickLook} onOpen={openFile} onRead={openPdf} />}
          {reader && (
            <Suspense fallback={<div className="pdfreader"><div className="pdf-msg">Opening…</div></div>}>
              <PdfReader entry={reader} onClose={closeReader} onOpenExternal={openFile} onPage={setReaderPage} />
            </Suspense>
          )}
        </div>
        {aiOpen && (
          <Suspense fallback={<aside className="aipanel"><div className="ai-empty">Loading…</div></aside>}>
            <AiPanel getContext={getAiContext} contextNow={getAiContext()} onClose={closeAi} onApply={applyPlan} />
          </Suspense>
        )}
      </main>

      <StatusBar
        summary={summary}
        note={opActive && op ? opActiveText(op) : (note?.text ?? null)}
        noteIsError={!opActive && !!note?.error}
        onCancelOp={opActive && op ? () => window.orbit.cancelOp(op.id) : null}
        onStopSearch={s.deep?.running ? () => handleOf(active)?.clearSearch() : null}
        listMs={s.path === null ? null : s.listMs}
        pane={dual ? (active === 'left' ? 'Left pane' : 'Right pane') : null}
      />
    </div>
  )
}
