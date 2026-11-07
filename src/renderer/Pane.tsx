import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { DriveInfo, FileEntry, ListEvent, Place, SearchEvent } from '@shared/types'
import { baseName, parentPath } from '@shared/paths'
import { dropVerdict } from '@shared/dnd'
import { fileKind } from '@shared/fileKind'
import type { Recent } from '@shared/recents'
import { compareEntries, type SortKey, type SortState } from '@shared/sort'
import { HomePage } from './HomePage'
import { Icon } from './Icons'
import { PaneBar, type DeepStatus } from './PaneBar'
import { KIND_ICON } from './fileIcon'
import { Thumb } from './Thumb'
import { RecycleBin } from './RecycleBin'
import { ContextMenu, type MenuEntry } from './ContextMenu'
import { CommandBar } from './CommandBar'
import { backgroundMenu, itemMenu, newItems } from './menus'
import { formatSize } from './format'
import { endDrag, getDrag, startDrag } from './dragSession'
import { nextRequestId } from './requestId'
import { SelectionStore } from './selection'
import { load, save } from './storage'

export type PaneId = 'left' | 'right'
type Layout = 'details' | 'compact' | 'grid'

export interface PaneStats {
  path: string | null
  listMs: number | null
  total: number
  shown: number
  selected: number
  deep: DeepStatus | null
  /** null unless the Recycle Bin view is showing; then the number of items in it (-1 while unknown). */
  bin: number | null
}

export interface PaneHandle {
  open: (path: string) => void
  showHome: () => void
  openBin: () => void
  focusList: () => void
  focusSearch: () => void
  /** Ends a search (folder filter or deep search) and clears the box. */
  clearSearch: () => void
  /** The selected items, or the focused item when nothing is selected. */
  targets: () => string[]
}

interface PaneProps {
  id: PaneId
  active: boolean
  canSwitch: boolean
  initialPath: string | null
  places: Place[]
  drives: DriveInfo[]
  recents: Recent[]
  /** Increments whenever a file operation finished: every pane refreshes. */
  refreshTick: number
  quickLookOpen: boolean
  onActivate: (id: PaneId) => void
  onPathChange: (id: PaneId, path: string | null) => void
  onNavigated: (path: string) => void
  onStats: (id: PaneId, stats: PaneStats) => void
  onFocusEntry: (id: PaneId, entry: FileEntry | null) => void
  onToggleQuickLook: () => void
  onCloseQuickLook: () => void
  onClipboard: (mode: 'copy' | 'cut', paths: string[]) => void
  onPaste: (targetDir: string) => void
  onUndo: () => void
  onTrash: (paths: string[]) => void
  onRename: (path: string, newName: string) => void
  onTransfer: (paths: string[], targetDir: string, copy: boolean) => void
  onSwitchPane: () => void
  /** How many items are on the clipboard (0 = nothing to paste). */
  clipCount: number
  onOpenInOther: (from: PaneId, path: string) => void
  onMessage: (text: string, error?: boolean) => void
  /** Opens a PDF in ORBIT's own reader. */
  onOpenPdf: (entry: FileEntry) => void
  onCopilot: () => void
  onMonitor: () => void
}

const ROW_H: Record<Layout, number> = { details: 36, compact: 28, grid: 116 }
const TILE_W = 124
const PAGE_ROWS = 15

const LAYOUTS: Array<{ id: Layout; label: string }> = [
  { id: 'details', label: 'Details' },
  { id: 'compact', label: 'Compact list' },
  { id: 'grid', label: 'Icons' }
]

const SORT_LABEL: Record<SortKey, string> = { name: 'Name', size: 'Size', modified: 'Date modified' }

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi)

function initialLayout(): Layout {
  const l = load<string>('orbit.layout', 'details')
  return l === 'compact' || l === 'grid' ? l : 'details'
}
function initialSort(): SortState {
  const s = load<Partial<SortState>>('orbit.sort', {})
  const key: SortKey = s.key === 'size' || s.key === 'modified' ? s.key : 'name'
  return { key, dir: s.dir === 'desc' ? 'desc' : 'asc' }
}

/** Folder of a search result, relative to the folder the search started in ('' = directly inside it). */
function whereOf(entryPath: string, root: string): string {
  const dir = parentPath(entryPath)
  const r = root.replace(/[\\/]+$/, '')
  const rel = dir.toLowerCase().startsWith(r.toLowerCase()) ? dir.slice(r.length) : dir
  return rel.replace(/^[\\/]+/, '')
}

interface DeepState extends DeepStatus {
  root: string
}

interface DropInfo {
  /** Folder that would receive the items. */
  target: string
  copy: boolean
  count: number
}

const PaneImpl = forwardRef<PaneHandle, PaneProps>(function Pane(props, ref) {
  const { id, active, canSwitch, places, drives, recents, refreshTick, quickLookOpen, clipCount } = props
  // Latest props for callbacks that must stay stable (listeners, effects).
  const p = useRef(props)
  p.current = props

  const [selection] = useState(() => new SelectionStore())
  const selVersion = useSyncExternalStore(selection.subscribe, selection.getVersion)

  // path === null means this pane shows the Home page.
  const [path, setPath] = useState<string | null>(null)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [listMs, setListMs] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [deep, setDeep] = useState<DeepState | null>(null)
  const [deepEntries, setDeepEntries] = useState<FileEntry[]>([])
  const [layout, setLayout] = useState<Layout>(initialLayout)
  const [sort, setSort] = useState<SortState>(initialSort)
  const [cols, setCols] = useState(6)
  const [drop, setDrop] = useState<DropInfo | null>(null)

  const [bin, setBin] = useState(false) // the Recycle Bin view (path stays null while it is shown)
  const [binCount, setBinCount] = useState<number | null>(null)
  const binRef = useRef(false)
  const isHome = path === null && !bin
  const pathRef = useRef<string | null>(null)
  const visibleRef = useRef<FileEntry[]>([])
  const colsRef = useRef(6)
  const activeRequest = useRef<number | null>(null)
  const deepRequest = useRef<number | null>(null)
  const buffer = useRef<FileEntry[]>([])
  const flushTimer = useRef<number | null>(null)
  const soft = useRef(false) // soft refresh: keep the old list on screen until the new one is complete
  const wantCreate = useRef(false) // this pane asked for a new folder/file and is waiting to rename it
  const pendingRename = useRef<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null)
  // Latest menu openers, so the stable keyboard handler can call them.
  const menuApi = useRef<{ item: (x: number, y: number, index: number, entry: FileEntry) => void; bg: (x: number, y: number) => void; create: (kind: 'mkdir' | 'newfile') => void; copyPaths: () => void }>({
    item: () => undefined,
    bg: () => undefined,
    create: () => undefined,
    copyPaths: () => undefined
  })
  const pendingSelect = useRef<string | null>(null) // select this path once the next listing lands
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  colsRef.current = cols

  // ---------- listing ----------

  // Chunks are buffered and flushed at most once per animation frame,
  // so a 50k-file folder causes a handful of renders, not hundreds.
  const scheduleFlush = useCallback(() => {
    if (soft.current || flushTimer.current !== null) return
    flushTimer.current = requestAnimationFrame(() => {
      flushTimer.current = null
      setEntries(buffer.current.slice())
    })
  }, [])

  useEffect(() => {
    return window.orbit.onListEvent((e: ListEvent) => {
      if (e.requestId !== activeRequest.current) return // another pane's, or a stale folder's
      if (e.type === 'chunk') {
        buffer.current.push(...e.entries)
        scheduleFlush()
      } else if (e.type === 'done') {
        const next = buffer.current.slice()
        setEntries(next)
        setListMs(e.ms)
        soft.current = false
        if (deepRequest.current === null) {
          // Drop selected paths that no longer exist; keep the cursor in range.
          const alive = new Set(next.map((x) => x.path))
          selection.replace(selection.paths().filter((x) => alive.has(x)))
          selection.setCursor(clamp(selection.cursor, next.length ? 0 : -1, next.length - 1))
        }
      } else {
        soft.current = false
        setError(e.message)
      }
    })
  }, [scheduleFlush, selection])

  // ---------- deep (recursive) search ----------

  const exitDeep = useCallback(() => {
    if (deepRequest.current !== null) window.orbit.cancelSearch(deepRequest.current)
    deepRequest.current = null
    setDeep(null)
    setDeepEntries([])
  }, [])

  const startDeep = useCallback(
    (q: string) => {
      const root = pathRef.current
      const text = q.trim()
      if (!root || !text) return
      if (deepRequest.current !== null) window.orbit.cancelSearch(deepRequest.current)
      selection.clear()
      setDeepEntries([])
      setDeep({ running: true, count: 0, limited: false, root })
      const rid = nextRequestId()
      deepRequest.current = rid
      window.orbit.search(rid, root, text)
    },
    [selection]
  )

  useEffect(() => {
    return window.orbit.onSearchEvent((e: SearchEvent) => {
      if (e.requestId !== deepRequest.current) return
      if (e.type === 'chunk') {
        setDeepEntries((prev) => prev.concat(e.entries))
        setDeep((d) => d && { ...d, count: d.count + e.entries.length })
      } else if (e.type === 'done') {
        setDeep((d) => d && { ...d, running: false, limited: e.limited })
      } else {
        setDeep((d) => d && { ...d, running: false })
        setError(e.message)
      }
    })
  }, [])

  // ---------- navigation ----------

  const resetView = useCallback(() => {
    pendingRename.current = null
    wantCreate.current = false
    setMenu(null)
    exitDeep()
    setQuery('')
    setEntries([])
    selection.clear()
    setListMs(null)
    setRenaming(null)
    scrollRef.current?.scrollTo({ top: 0 })
  }, [exitDeep, selection])

  const open = useCallback(
    (dir: string, opts?: { soft?: boolean; silent?: boolean }) => {
      if (activeRequest.current !== null) window.orbit.cancelList(activeRequest.current)
      buffer.current = []
      soft.current = opts?.soft ?? false
      if (!soft.current) {
        resetView()
        if (!opts?.silent) p.current.onNavigated(dir)
      }
      setError(null)
      binRef.current = false
      setBin(false)
      pathRef.current = dir
      setPath(dir)
      p.current.onPathChange(id, dir)
      const rid = nextRequestId()
      activeRequest.current = rid
      window.orbit.listDir(rid, dir)
    },
    [id, resetView]
  )

  const showHome = useCallback(() => {
    if (activeRequest.current !== null) window.orbit.cancelList(activeRequest.current)
    activeRequest.current = null
    buffer.current = []
    soft.current = false
    resetView()
    setError(null)
    binRef.current = false
    setBin(false)
    pathRef.current = null
    setPath(null)
    p.current.onPathChange(id, null)
  }, [id, resetView])

  const openBin = useCallback(() => {
    if (activeRequest.current !== null) window.orbit.cancelList(activeRequest.current)
    activeRequest.current = null
    buffer.current = []
    soft.current = false
    resetView()
    setError(null)
    pathRef.current = null
    setPath(null)
    binRef.current = true
    setBin(true)
    p.current.onPathChange(id, null)
    p.current.onFocusEntry(id, null)
  }, [id, resetView])

  const refresh = useCallback(() => {
    if (pathRef.current) open(pathRef.current, { soft: true })
  }, [open])

  const goUp = useCallback(() => {
    if (binRef.current) return showHome()
    const cur = pathRef.current
    if (!cur) return
    const up = parentPath(cur)
    if (up !== cur) open(up)
    else showHome() // above a drive root is the Home page
  }, [open, showHome])

  const focusList = useCallback(() => {
    scrollRef.current?.focus()
  }, [])

  // Open the starting folder once (the right pane starts where the left one is).
  useEffect(() => {
    if (p.current.initialPath) open(p.current.initialPath, { silent: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A file operation finished somewhere: refresh (skip the very first run).
  const firstTick = useRef(true)
  useEffect(() => {
    if (firstTick.current) {
      firstTick.current = false
      return
    }
    if (pathRef.current) open(pathRef.current, { soft: true })
  }, [refreshTick, open])

  // ---------- what is on screen ----------

  const terms = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query])

  const filtered = useMemo(
    () =>
      terms.length === 0
        ? entries
        : entries.filter((e) => {
            const name = e.name.toLowerCase()
            return terms.every((t) => name.includes(t))
          }),
    [entries, terms]
  )

  // While a folder is still streaming in we skip sorting (cheap, no jumping); one sort when it completes.
  const cmp = useMemo(() => compareEntries(sort), [sort])
  const shown = useMemo(() => (listMs === null ? filtered : filtered.slice().sort(cmp)), [filtered, listMs, cmp])

  const visible = deep ? deepEntries : shown
  visibleRef.current = visible

  const isGrid = layout === 'grid' && !isHome
  const rowCount = isGrid ? Math.ceil(visible.length / cols) : visible.length
  const rowSize = ROW_H[layout]

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowSize,
    overscan: isGrid ? 4 : 12
  })

  // Row heights changed (layout switch) or the column count changed (pane resized).
  useEffect(() => {
    virtualizer.measure()
  }, [virtualizer, rowSize, cols])

  // Grid column count follows the width of the list area.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = (): void => setCols(Math.max(1, Math.floor((el.clientWidth - 16) / TILE_W)))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [isHome])

  const scrollToItem = useCallback(
    (i: number) => {
      virtualizer.scrollToIndex(isGrid ? Math.floor(i / colsRef.current) : i, { align: 'auto' })
    },
    [virtualizer, isGrid]
  )

  // After "show in folder" from a search result: select the file once its folder has loaded.
  useEffect(() => {
    const target = pendingSelect.current
    if (!target || listMs === null) return
    const i = visible.findIndex((e) => e.path === target)
    if (i >= 0) {
      selection.replace([target])
      selection.setCursor(i, i)
      virtualizer.scrollToIndex(isGrid ? Math.floor(i / colsRef.current) : i, { align: 'center' })
    }
    pendingSelect.current = null
  }, [visible, listMs, virtualizer, isGrid, selection])

  // ---------- reporting to the app (status bar, Quick Look) ----------

  const cursorEntry = visible[selection.cursor] ?? null
  const selectedCount = selection.size

  useEffect(() => {
    if (active) p.current.onFocusEntry(id, cursorEntry)
  }, [active, id, cursorEntry])

  useEffect(() => {
    p.current.onStats(id, {
      path,
      listMs,
      total: entries.length,
      shown: visible.length,
      selected: selectedCount,
      deep: deep ? { running: deep.running, count: deep.count, limited: deep.limited } : null,
      bin: bin ? (binCount ?? -1) : null
    })
  }, [id, path, listMs, entries.length, visible.length, selectedCount, selVersion, deep, bin, binCount])

  // ---------- search box ----------

  const onQuery = useCallback(
    (q: string) => {
      if (deepRequest.current !== null) exitDeep() // typing again goes back to the instant folder filter
      setQuery(q)
      selection.clear()
    },
    [exitDeep, selection]
  )

  const clearSearch = useCallback(() => {
    exitDeep()
    setQuery('')
    selection.clear()
    scrollRef.current?.focus()
  }, [exitDeep, selection])

  // Stop-search is reachable from the status bar via stats; expose through the deep state.
  const focusFirst = useCallback(() => {
    scrollRef.current?.focus()
    const first = visibleRef.current[0]
    if (first && selection.cursor < 0) {
      selection.replace([first.path])
      selection.setCursor(0, 0)
    }
  }, [selection])

  // ---------- selection helpers ----------

  const selectRange = useCallback(
    (from: number, to: number) => {
      const list = visibleRef.current
      const lo = Math.min(from, to)
      const hi = Math.max(from, to)
      selection.replace(list.slice(lo, hi + 1).map((e) => e.path))
    },
    [selection]
  )

  const moveCursor = useCallback(
    (to: number, extend: boolean) => {
      const list = visibleRef.current
      if (list.length === 0) return
      const i = clamp(to, 0, list.length - 1)
      if (extend) {
        const anchor = selection.anchor < 0 ? clamp(selection.cursor, 0, list.length - 1) : selection.anchor
        selectRange(anchor, i)
        selection.setCursor(i, anchor)
      } else {
        const entry = list[i]
        if (entry) selection.replace([entry.path])
        selection.setCursor(i, i)
      }
      scrollToItem(i)
    },
    [selection, selectRange, scrollToItem]
  )

  /** What an action applies to: the selection, or the focused item if nothing is selected. */
  const targets = useCallback((): string[] => {
    if (selection.size > 0) return selection.paths()
    const e = visibleRef.current[selection.cursor]
    return e ? [e.path] : []
  }, [selection])

  // What the app shell can ask of this pane (sidebar clicks, Ctrl+F, F6 move-to-other-pane, stop search).
  useImperativeHandle(
    ref,
    () => ({
      open: (dir: string) => open(dir),
      showHome,
      openBin,
      focusList,
      focusSearch: () => {
        searchRef.current?.focus()
        searchRef.current?.select()
      },
      clearSearch,
      targets
    }),
    [open, showHome, openBin, focusList, clearSearch, targets]
  )

  const openEntry = useCallback(
    (entry: FileEntry) => {
      if (entry.isDir) {
        open(entry.path)
      } else if (deepRequest.current !== null) {
        // A file found by search: jump to its folder and highlight it.
        pendingSelect.current = entry.path
        open(parentPath(entry.path))
      } else if (fileKind(entry.name, false) === 'pdf') {
        p.current.onOpenPdf(entry)
      } else {
        void window.orbit.openPath(entry.path).then((err) => {
          if (err) p.current.onMessage(`Couldn't open ${entry.name}: ${err}`, true)
        })
      }
    },
    [open]
  )

  const startRename = useCallback(() => {
    const e = visibleRef.current[selection.cursor]
    if (e) setRenaming(e.path)
  }, [selection])

  const commitRename = useCallback((entryPath: string, newName: string) => {
    setRenaming(null)
    scrollRef.current?.focus()
    const oldName = entryPath.split(/[\\/]/).pop()
    const name = newName.trim()
    if (!name || name === oldName) return
    p.current.onRename(entryPath, name)
  }, [])

  // ---------- keyboard + mouse on the list ----------

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const list = visibleRef.current
      const ctrl = e.ctrlKey || e.metaKey
      const step = isGrid ? colsRef.current : 1
      const handled = (): void => {
        e.preventDefault()
        e.stopPropagation()
      }

      // Menu key / Shift+F10: open the context menu at the focused item.
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        handled()
        const box = scrollRef.current?.getBoundingClientRect()
        const cur = scrollRef.current?.querySelector('.cur')?.getBoundingClientRect()
        const x = (cur ? cur.left + 24 : (box?.left ?? 0) + 40)
        const y = (cur ? cur.bottom - 6 : (box?.top ?? 0) + 40)
        const entry = list[selection.cursor]
        if (entry) menuApi.current.item(x, y, selection.cursor, entry)
        else menuApi.current.bg(x, y)
        return
      }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === 'c') {
        handled()
        menuApi.current.copyPaths()
        return
      }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === 'n') {
        handled()
        menuApi.current.create('mkdir')
        return
      }

      switch (e.key) {
        case 'ArrowDown':
          handled()
          moveCursor(selection.cursor + step, e.shiftKey)
          return
        case 'ArrowUp':
          handled()
          moveCursor(selection.cursor - step, e.shiftKey)
          return
        case 'ArrowRight':
          if (isGrid) {
            handled()
            moveCursor(selection.cursor + 1, e.shiftKey)
          }
          return
        case 'ArrowLeft':
          if (isGrid) {
            handled()
            moveCursor(selection.cursor - 1, e.shiftKey)
          }
          return
        case 'PageDown':
          handled()
          moveCursor(selection.cursor + (isGrid ? step * 4 : PAGE_ROWS), e.shiftKey)
          return
        case 'PageUp':
          handled()
          moveCursor(selection.cursor - (isGrid ? step * 4 : PAGE_ROWS), e.shiftKey)
          return
        case 'Home':
          handled()
          moveCursor(0, e.shiftKey)
          return
        case 'End':
          handled()
          moveCursor(list.length - 1, e.shiftKey)
          return
        case ' ':
          handled()
          p.current.onToggleQuickLook()
          return
        case 'Tab':
          if (canSwitch && !e.shiftKey) {
            handled()
            p.current.onSwitchPane()
          }
          return
        case 'Enter': {
          handled()
          const entry = list[selection.cursor]
          if (entry) openEntry(entry)
          return
        }
        case 'Backspace':
          handled()
          goUp()
          return
        case 'Escape':
          handled()
          if (p.current.quickLookOpen) p.current.onCloseQuickLook()
          else if (deepRequest.current !== null || query) clearSearch()
          else selection.replace([])
          return
        case 'F2':
          handled()
          startRename()
          return
        case 'F5':
          handled()
          refresh()
          return
        case 'Delete': {
          handled()
          const paths = targets()
          if (paths.length > 0) p.current.onTrash(paths)
          return
        }
      }

      if (ctrl) {
        switch (e.key.toLowerCase()) {
          case 'a':
            handled()
            selection.replace(list.map((x) => x.path))
            return
          case 'c':
          case 'x': {
            handled()
            const paths = targets()
            if (paths.length > 0) p.current.onClipboard(e.key.toLowerCase() === 'c' ? 'copy' : 'cut', paths)
            return
          }
          case 'v':
            handled()
            if (pathRef.current) p.current.onPaste(pathRef.current)
            return
          case 'z':
            handled()
            p.current.onUndo()
            return
        }
      }
    },
    [isGrid, canSwitch, moveCursor, selection, openEntry, goUp, startRename, refresh, targets, clearSearch, query]
  )

  // ---------- context menu, new folder / file ----------

  const closeMenu = useCallback(() => {
    setMenu(null)
    scrollRef.current?.focus()
  }, [])

  const copyPaths = (): void => {
    const paths = targets()
    if (paths.length === 0) return
    window.orbit.copyText(paths.map((x) => `"${x}"`).join('\r\n'))
    p.current.onMessage(paths.length === 1 ? 'Copied the path' : `Copied ${paths.length} paths`)
  }

  const createNew = (kind: 'mkdir' | 'newfile'): void => {
    const dir = pathRef.current
    if (!dir || deepRequest.current !== null) return
    wantCreate.current = true
    void window.orbit.enqueue({ kind, sources: [], target: dir })
  }

  const showItemMenu = (x: number, y: number, index: number, entry: FileEntry): void => {
    // Right-clicking an item outside the selection selects just that item, like Explorer.
    if (!selection.has(entry.path)) selection.replace([entry.path])
    selection.setCursor(index, index)
    const paths = selection.paths()
    const single = paths.length === 1 ? { isDir: entry.isDir, pdf: !entry.isDir && fileKind(entry.name, false) === 'pdf', zip: !entry.isDir && /\.zip$/i.test(entry.name) } : null
    setMenu({
      x,
      y,
      items: itemMenu(
        { count: paths.length, single, canPaste: clipCount > 0, dual: canSwitch, deep: deep !== null },
        {
          open: () => openEntry(entry),
          openDefault: () => {
            void window.orbit.openPath(entry.path).then((err) => {
              if (err) p.current.onMessage(`Couldn't open ${entry.name}: ${err}`, true)
            })
          },
          openOtherPane: () => p.current.onOpenInOther(id, entry.path),
          quickLook: () => p.current.onToggleQuickLook(),
          cut: () => p.current.onClipboard('cut', paths),
          copy: () => p.current.onClipboard('copy', paths),
          pasteInto: () => p.current.onPaste(entry.path),
          rename: () => setRenaming(entry.path),
          trash: () => p.current.onTrash(paths),
          copyPath: copyPaths,
          reveal: () => window.orbit.revealPath(entry.path),
          compress: () => {
            p.current.onMessage('Compressing…')
            void window.orbit.enqueue({ kind: 'zip', sources: paths })
          },
          extractFolder: () => void window.orbit.enqueue({ kind: 'unzip', sources: [entry.path], mode: 'folder' }),
          extractHere: () => void window.orbit.enqueue({ kind: 'unzip', sources: [entry.path], mode: 'here' })
        }
      )
    })
  }

  const showBgMenu = (x: number, y: number): void => {
    const dir = pathRef.current
    if (!dir || deepRequest.current !== null) return // nothing to create in while showing search results
    selection.clear()
    setMenu({
      x,
      y,
      items: backgroundMenu(
        { layout, sortKey: sort.key, sortDir: sort.dir, canPaste: clipCount > 0 },
        {
          setLayout: (l) => chooseLayout(l as Layout),
          setSortKey: (k) => {
            const next: SortState = { key: k as SortKey, dir: sort.dir }
            setSort(next)
            save('orbit.sort', next)
          },
          setSortDir: (d) => {
            const next: SortState = { key: sort.key, dir: d }
            setSort(next)
            save('orbit.sort', next)
          },
          refresh,
          paste: () => p.current.onPaste(dir),
          undo: () => p.current.onUndo(),
          selectAll: () => selection.replace(visibleRef.current.map((x) => x.path)),
          newFolder: () => createNew('mkdir'),
          newTextFile: () => createNew('newfile'),
          copyPath: () => {
            window.orbit.copyText(`"${dir}"`)
            p.current.onMessage('Copied the path')
          },
          openInExplorer: () => void window.orbit.openPath(dir)
        }
      )
    })
  }

  const showNewMenu = (x: number, y: number): void =>
    setMenu({ x, y, items: newItems({ newFolder: () => createNew('mkdir'), newTextFile: () => createNew('newfile') }) })

  menuApi.current = { item: showItemMenu, bg: showBgMenu, create: createNew, copyPaths }

  // After New folder / New text document is created: select it and start renaming, like Explorer.
  useEffect(() => {
    return window.orbit.onOpProgress((pr) => {
      if (!wantCreate.current || (pr.kind !== 'mkdir' && pr.kind !== 'newfile')) return
      if (pr.status === 'done' && pr.created) {
        wantCreate.current = false
        pendingRename.current = pr.created
      } else if (pr.status === 'failed' || pr.status === 'cancelled') {
        wantCreate.current = false
      }
    })
  }, [])

  useEffect(() => {
    const target = pendingRename.current
    if (!target) return
    const i = visible.findIndex((e) => e.path === target)
    if (i < 0) return // the refreshed listing has not arrived yet
    pendingRename.current = null
    selection.replace([target])
    selection.setCursor(i, i)
    virtualizer.scrollToIndex(isGrid ? Math.floor(i / colsRef.current) : i, { align: 'center' })
    setRenaming(target)
  }, [visible, virtualizer, isGrid, selection])

  const onItemClick = (e: MouseEvent, index: number, entry: FileEntry): void => {
    scrollRef.current?.focus()
    if (e.shiftKey) {
      const anchor = selection.anchor < 0 ? index : selection.anchor
      selectRange(anchor, index)
      selection.setCursor(index, anchor)
    } else if (e.ctrlKey || e.metaKey) {
      selection.toggle(entry.path)
      selection.setCursor(index, index)
    } else {
      selection.replace([entry.path])
      selection.setCursor(index, index)
    }
  }

  const clickHeader = (key: SortKey): void => {
    const next: SortState = sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    setSort(next)
    save('orbit.sort', next)
  }

  const chooseLayout = (l: Layout): void => {
    setLayout(l)
    save('orbit.layout', l)
  }

  // ---------- drag and drop ----------

  const onItemDragStart = (e: DragEvent, index: number, entry: FileEntry): void => {
    // Dragging an item that is part of the selection drags the whole selection; otherwise just that item.
    let paths: string[]
    if (selection.has(entry.path)) {
      paths = selection.paths()
    } else {
      selection.replace([entry.path])
      selection.setCursor(index, index)
      paths = [entry.path]
    }
    startDrag(paths)
    e.dataTransfer.effectAllowed = 'copyMove'
    e.dataTransfer.setData('text/plain', paths.join('\n'))
  }

  const onItemDragEnd = (): void => {
    endDrag()
    setDrop(null)
  }

  /** Shows the drop as allowed (or not) for `target`. A null target means "nothing droppable here". */
  const onDragOverTarget = (e: DragEvent, target: string | null): void => {
    const session = getDrag()
    // Not droppable here: no preventDefault (the cursor shows "not allowed") and no stale highlight left behind.
    const clearDrop = (): void => setDrop((prev) => (prev === null ? prev : null))
    if (!session || target === null) return clearDrop()
    const copy = e.ctrlKey
    if (dropVerdict(session.paths, target, copy) !== 'ok') return clearDrop()
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = copy ? 'copy' : 'move'
    setDrop((prev) =>
      prev && prev.target === target && prev.copy === copy && prev.count === session.paths.length
        ? prev
        : { target, copy, count: session.paths.length }
    )
  }

  const onDropOnTarget = (e: DragEvent, target: string | null): void => {
    const session = getDrag()
    setDrop(null)
    if (!session || target === null) return
    e.preventDefault()
    e.stopPropagation()
    const copy = e.ctrlKey
    endDrag()
    if (dropVerdict(session.paths, target, copy) === 'ok') p.current.onTransfer(session.paths, target, copy)
  }

  // Whatever way a drag ends (dropped, cancelled, dropped elsewhere), clear the highlight.
  useEffect(() => {
    const clear = (): void => setDrop(null)
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [])

  // ---------- render ----------

  const paneTarget = isHome || deep ? null : path // dropping on the empty part of the pane goes into its folder

  const renderName = (entry: FileEntry, where: string): JSX.Element =>
    renaming === entry.path ? (
      <RenameInput
        name={entry.name}
        isDir={entry.isDir}
        onCommit={(n) => commitRename(entry.path, n)}
        onCancel={() => {
          setRenaming(null)
          scrollRef.current?.focus()
        }}
      />
    ) : (
      <>
        <span className="name">{entry.name}</span>
        {where && <span className="where">{where}</span>}
      </>
    )

  const renderItem = (index: number): JSX.Element | null => {
    const entry = visible[index]
    if (!entry) return null
    const kind = fileKind(entry.name, entry.isDir)
    const isSel = selection.has(entry.path)
    const isCur = index === selection.cursor
    const isDrop = entry.isDir && drop?.target === entry.path
    const cls = `${isSel ? ' sel' : ''}${isCur ? ' cur' : ''}${isDrop ? ' dropt' : ''}`
    const dragProps = {
      onContextMenu: (e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        showItemMenu(e.clientX, e.clientY, index, entry)
      },
      draggable: renaming !== entry.path,
      onDragStart: (e: DragEvent) => onItemDragStart(e, index, entry),
      onDragEnd: onItemDragEnd,
      // Only folders accept drops themselves; for files the event bubbles to the pane.
      ...(entry.isDir
        ? {
            onDragOver: (e: DragEvent) => onDragOverTarget(e, entry.path),
            onDrop: (e: DragEvent) => onDropOnTarget(e, entry.path)
          }
        : {})
    }

    if (isGrid) {
      return (
        <div
          key={entry.path}
          className={`tile${cls}`}
          title={entry.name}
          onClick={(e) => onItemClick(e, index, entry)}
          onDoubleClick={() => openEntry(entry)}
          {...dragProps}
        >
          <Thumb entry={entry} kind={kind} />
          <span className="tile-name">{renaming === entry.path ? renderName(entry, '') : entry.name}</span>
        </div>
      )
    }

    return (
      <div
        key={entry.path}
        className={`row ${layout}${cls}`}
        onClick={(e) => onItemClick(e, index, entry)}
        onDoubleClick={() => openEntry(entry)}
        {...dragProps}
      >
        <span className="c-name">
          <Icon name={KIND_ICON[kind]} size={layout === 'compact' ? 16 : 18} className={`ic k-${kind}`} />
          {renderName(entry, deep ? whereOf(entry.path, deep.root) : '')}
        </span>
        <span className="c-size">{entry.isDir ? '' : formatSize(entry.size)}</span>
        <span className="c-date">{entry.mtimeMs ? new Date(entry.mtimeMs).toLocaleString() : ''}</span>
      </div>
    )
  }

  let emptyText: string | null = null
  if (!isHome && visible.length === 0) {
    if (deep) emptyText = deep.running ? 'Searching…' : 'No results'
    else if (query.trim()) emptyText = `No items here match “${query.trim()}”. Press Enter to search subfolders.`
    else if (listMs !== null) emptyText = 'This folder is empty'
  }

  const arrow = (key: SortKey): JSX.Element | null =>
    sort.key === key && !deep ? (
      <Icon name="up" size={12} className={`sortarrow${sort.dir === 'desc' ? ' desc' : ''}`} />
    ) : null

  const dropLabel = drop
    ? `${drop.copy ? 'Copy' : 'Move'} ${drop.count} ${drop.count === 1 ? 'item' : 'items'} to “${baseName(drop.target)}”`
    : null

  return (
    <section
      className={`pane${active ? ' active' : ''}`}
      onMouseDownCapture={() => p.current.onActivate(id)}
      onFocusCapture={() => p.current.onActivate(id)}
    >
      <PaneBar
        path={path}
        bin={bin}
        onUp={goUp}
        onHome={showHome}
        onNavigate={open}
        query={query}
        onQuery={onQuery}
        onDeepSearch={() => startDeep(query)}
        onEscape={clearSearch}
        onArrowDown={focusFirst}
        inputRef={searchRef}
        deep={deep}
      />

      {error && <div className="error">{error}</div>}

      {bin ? (
        <RecycleBin refreshTick={refreshTick} onMessage={(t, e) => p.current.onMessage(t, e)} onCount={setBinCount} onUp={showHome} />
      ) : isHome ? (
        <HomePage places={places} drives={drives} recents={recents} onOpen={open} onBin={openBin} onCopilot={p.current.onCopilot} onMonitor={p.current.onMonitor} />
      ) : (
        <>
          <div className="toolbar">
            <CommandBar
              hasTarget={selectedCount > 0}
              canRename={selectedCount === 1 && !deep}
              canPaste={clipCount > 0 && !deep}
              canCreate={!deep}
              onNew={showNewMenu}
              onCut={() => {
                const t = selection.paths() // the bar acts on the selection only, like Explorer
                if (t.length) p.current.onClipboard('cut', t)
              }}
              onCopy={() => {
                const t = selection.paths()
                if (t.length) p.current.onClipboard('copy', t)
              }}
              onPaste={() => pathRef.current && p.current.onPaste(pathRef.current)}
              onRename={() => {
                const only = selection.paths()
                if (only.length === 1 && only[0]) setRenaming(only[0])
              }}
              onTrash={() => {
                const t = selection.paths()
                if (t.length) p.current.onTrash(t)
              }}
            />
            <div className="sortbox">
              <label htmlFor={`sortkey-${id}`}>Sort</label>
              <select
                id={`sortkey-${id}`}
                value={sort.key}
                disabled={!!deep}
                onChange={(e) => {
                  const next: SortState = { key: e.target.value as SortKey, dir: sort.dir }
                  setSort(next)
                  save('orbit.sort', next)
                }}
              >
                {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABEL[k]}
                  </option>
                ))}
              </select>
              <button
                className="iconbtn small"
                disabled={!!deep}
                title={sort.dir === 'asc' ? 'Ascending' : 'Descending'}
                onClick={() => {
                  const next: SortState = { key: sort.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
                  setSort(next)
                  save('orbit.sort', next)
                }}
              >
                <Icon name="up" size={14} className={sort.dir === 'desc' ? 'sortarrow desc' : 'sortarrow'} />
              </button>
            </div>

            <div className="segmented" role="group" aria-label="Layout">
              {LAYOUTS.map((l) => (
                <button key={l.id} className={layout === l.id ? 'on' : ''} title={l.label} onClick={() => chooseLayout(l.id)}>
                  <Icon name={l.id === 'details' ? 'details' : l.id === 'compact' ? 'compact' : 'grid'} size={16} />
                </button>
              ))}
            </div>
          </div>

          {!isGrid && (
            <div className="head">
              <button className="c-name hbtn" onClick={() => clickHeader('name')} disabled={!!deep}>
                {deep ? 'Name · Location' : 'Name'}
                {arrow('name')}
              </button>
              <button className="c-size hbtn" onClick={() => clickHeader('size')} disabled={!!deep}>
                {arrow('size')}Size
              </button>
              <button className="c-date hbtn" onClick={() => clickHeader('modified')} disabled={!!deep}>
                {arrow('modified')}Modified
              </button>
            </div>
          )}

          <div
            className={`listwrap${drop && drop.target === path ? ' dropzone' : ''}`}
            onDragOver={(e) => onDragOverTarget(e, paneTarget)}
            onDrop={(e) => onDropOnTarget(e, paneTarget)}
            onDragLeave={(e) => {
              // Chromium leaves relatedTarget null on drag events, so decide by pointer position instead:
              // moving from one row to the next stays inside the list and must not clear the highlight.
              const r = e.currentTarget.getBoundingClientRect()
              const inside = e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom
              if (!inside) setDrop(null)
            }}
          >
            <div
              className="scroll"
              ref={scrollRef}
              tabIndex={0}
              onKeyDown={onKeyDown}
              onContextMenu={(e) => {
                e.preventDefault()
                showBgMenu(e.clientX, e.clientY)
              }}
            >
              <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                {virtualizer.getVirtualItems().map((v) =>
                  isGrid ? (
                    <div key={v.key} className="gridrow" style={{ transform: `translateY(${v.start}px)`, height: ROW_H.grid }}>
                      {Array.from({ length: cols }, (_, c) => renderItem(v.index * cols + c))}
                    </div>
                  ) : (
                    <div key={v.key} className="vrow" style={{ transform: `translateY(${v.start}px)`, height: rowSize }}>
                      {renderItem(v.index)}
                    </div>
                  )
                )}
              </div>
            </div>
            {emptyText && <div className="empty">{emptyText}</div>}
            {dropLabel && <div className="drophint">{dropLabel}</div>}
          </div>
        </>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
    </section>
  )
})

export const Pane = memo(PaneImpl)

interface RenameProps {
  name: string
  isDir: boolean
  onCommit: (name: string) => void
  onCancel: () => void
}

function RenameInput({ name, isDir, onCommit, onCancel }: RenameProps): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  // Enter/Escape unmount the input, which can fire a blur afterwards. Only the first outcome counts.
  const finished = useRef(false)
  const commit = (value: string): void => {
    if (finished.current) return
    finished.current = true
    onCommit(value)
  }
  const cancel = (): void => {
    if (finished.current) return
    finished.current = true
    onCancel()
  }

  useEffect(() => {
    const input = ref.current
    if (!input) return
    input.focus()
    // Select the base name only, so typing keeps the extension.
    const dot = name.lastIndexOf('.')
    input.setSelectionRange(0, !isDir && dot > 0 ? dot : name.length)
  }, [name, isDir])

  return (
    <input
      ref={ref}
      className="rename"
      defaultValue={name}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation() // keep list shortcuts (Delete, Backspace...) out of the text field
        if (e.key === 'Enter') commit(e.currentTarget.value)
        else if (e.key === 'Escape') cancel()
      }}
    />
  )
}
