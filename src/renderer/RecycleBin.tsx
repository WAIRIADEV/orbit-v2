import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { fileKind } from '@shared/fileKind'
import type { BinEntry, BinList } from '@shared/types'
import { ContextMenu, type MenuEntry } from './ContextMenu'
import { Icon } from './Icons'
import { binBackgroundMenu, binItemMenu } from './menus'
import { KIND_ICON } from './fileIcon'
import { formatSize } from './format'

interface Props {
  /** Changes whenever a file operation finished, so a freshly deleted file shows up here. */
  refreshTick: number
  onMessage: (text: string, error?: boolean) => void
  onCount: (n: number) => void
  onUp: () => void
}

type Confirm = 'purge' | 'empty' | null

const ROW_H = 36

export function RecycleBin({ refreshTick, onMessage, onCount, onUp }: Props): JSX.Element {
  const [data, setData] = useState<BinList | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null)

  const load = useCallback(async () => {
    const next = await window.orbit.binList()
    next.items.sort((a, b) => b.deletedMs - a.deletedMs) // newest first, like Explorer's usual use
    setData(next)
    onCount(next.items.length)
    // Forget selections for items that are gone.
    setSelected((prev) => {
      const ids = new Set(next.items.map((i) => i.id))
      const kept = [...prev].filter((id) => ids.has(id))
      return kept.length === prev.size ? prev : new Set(kept)
    })
  }, [onCount])

  useEffect(() => {
    void load()
  }, [load, refreshTick])

  const items = data?.items ?? []
  const rowsVirtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12
  })

  const selectedIds = useMemo(() => items.filter((i) => selected.has(i.id)).map((i) => i.id), [items, selected])

  const click = (e: React.MouseEvent, index: number, item: BinEntry): void => {
    setConfirm(null)
    if (e.shiftKey && anchor) {
      const a = items.findIndex((i) => i.id === anchor)
      const [lo, hi] = a < index ? [a, index] : [index, a]
      setSelected(new Set(items.slice(lo, hi + 1).map((i) => i.id)))
      return
    }
    setAnchor(item.id)
    if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const n = new Set(prev)
        if (!n.delete(item.id)) n.add(item.id)
        return n
      })
    } else setSelected(new Set([item.id]))
  }

  const run = async (action: () => Promise<{ ok: boolean; message: string }>): Promise<void> => {
    setBusy(true)
    setConfirm(null)
    try {
      const r = await action()
      onMessage(r.message, !r.ok)
    } catch (e) {
      onMessage((e as Error).message, true)
    } finally {
      setBusy(false)
      await load()
    }
  }

  const showItemMenu = (e: React.MouseEvent, item: BinEntry): void => {
    e.preventDefault()
    e.stopPropagation()
    // Right-clicking something outside the selection selects just that item, like Explorer.
    const ids = selected.has(item.id) ? selectedIds : [item.id]
    if (!selected.has(item.id)) setSelected(new Set([item.id]))
    setAnchor(item.id)
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: binItemMenu(ids.length, {
        restore: () => void run(() => window.orbit.binRestore(ids)),
        purge: () => setConfirm('purge'),
        selectAll: () => setSelected(new Set(items.map((i) => i.id)))
      })
    })
  }

  const showBackgroundMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: binBackgroundMenu(items.length > 0, {
        empty: () => setConfirm('empty'),
        refresh: () => void load(),
        selectAll: () => setSelected(new Set(items.map((i) => i.id)))
      })
    })
  }

  const closeMenu = useCallback(() => {
    setMenu(null)
    scrollRef.current?.focus()
  }, [])

  const restore = (): void => {
    if (selectedIds.length > 0) void run(() => window.orbit.binRestore(selectedIds))
  }
  const purge = (): void => void run(() => window.orbit.binPurge(selectedIds))
  const empty = (): void => void run(() => window.orbit.binEmpty())

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (busy) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      setSelected(new Set(items.map((i) => i.id)))
    } else if (e.key === 'Backspace') {
      e.preventDefault()
      onUp()
    } else if (e.key === 'Escape') {
      if (confirm) setConfirm(null)
      else setSelected(new Set())
    } else if (e.key === 'Delete' && selectedIds.length > 0) {
      e.preventDefault()
      setConfirm('purge')
    } else if (e.key === 'Enter' && selectedIds.length > 0) {
      e.preventDefault()
      restore()
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length > 0) {
      e.preventDefault()
      const cur = anchor ? items.findIndex((i) => i.id === anchor) : -1
      const next = Math.max(0, Math.min(items.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)))
      const item = items[next]
      if (!item) return
      setAnchor(item.id)
      setSelected(new Set([item.id]))
      rowsVirtual.scrollToIndex(next)
    }
  }

  if (data && !data.supported) {
    return (
      <div className="bin-empty">
        <Icon name="trash" size={48} />
        <p>The Recycle Bin view is only available on Windows.</p>
      </div>
    )
  }

  return (
    <div className="bin" onKeyDown={onKeyDown}>
      <div className="bin-bar">
        {confirm === 'purge' ? (
          <div className="bin-confirm" role="alertdialog">
            <span>
              Permanently delete {selectedIds.length.toLocaleString()} {selectedIds.length === 1 ? 'item' : 'items'}? This can’t be undone.
            </span>
            <button className="btn danger" onClick={purge} autoFocus>
              Delete permanently
            </button>
            <button className="btn" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        ) : confirm === 'empty' ? (
          <div className="bin-confirm" role="alertdialog">
            <span>Empty the whole Recycle Bin, on every drive? This can’t be undone.</span>
            <button className="btn danger" onClick={empty} autoFocus>
              Empty Recycle Bin
            </button>
            <button className="btn" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        ) : (
          <>
            <button className="btn primary" disabled={busy || selectedIds.length === 0} onClick={restore}>
              Restore{selectedIds.length > 1 ? ` ${selectedIds.length.toLocaleString()}` : ''}
            </button>
            <button className="btn" disabled={busy || selectedIds.length === 0} onClick={() => setConfirm('purge')}>
              Delete permanently
            </button>
            <span className="bin-spacer" />
            <button className="btn" disabled={busy || items.length === 0} onClick={() => setConfirm('empty')}>
              Empty Recycle Bin
            </button>
          </>
        )}
      </div>

      <div className="head bin-head">
        <span className="c-name">Name</span>
        <span className="c-from">Original location</span>
        <span className="c-date">Deleted</span>
        <span className="c-size">Size</span>
      </div>

      <div className="bin-list" ref={scrollRef} tabIndex={0} aria-label="Recycle Bin items" onContextMenu={showBackgroundMenu}>
        {data === null && <div className="bin-note">Reading the Recycle Bin…</div>}
        {data?.error && <div className="error">{data.error}</div>}
        {data && !data.error && items.length === 0 && <div className="bin-note">The Recycle Bin is empty</div>}
        <div style={{ height: rowsVirtual.getTotalSize(), position: 'relative' }}>
          {rowsVirtual.getVirtualItems().map((v) => {
            const item = items[v.index]
            if (!item) return null
            const kind = fileKind(item.name, item.isDir)
            return (
              <div
                key={item.id}
                className={`row details bin-row${selected.has(item.id) ? ' sel' : ''}`}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ROW_H, transform: `translateY(${v.start}px)` }}
                onClick={(e) => click(e, v.index, item)}
                onContextMenu={(e) => showItemMenu(e, item)}
                onDoubleClick={() => void run(() => window.orbit.binRestore([item.id]))}
                title={`${item.name}\n${item.from}`}
              >
                <span className="c-name">
                  <Icon name={KIND_ICON[kind]} size={18} className={`ic k-${kind}`} />
                  <span className="nm">{item.name}</span>
                </span>
                <span className="c-from">{item.from}</span>
                <span className="c-date">{item.deletedMs ? new Date(item.deletedMs).toLocaleString() : ''}</span>
                <span className="c-size">{item.isDir ? '' : formatSize(item.size)}</span>
              </div>
            )
          })}
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
    </div>
  )
}
