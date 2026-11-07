// Builds the entries for every context menu. Pure functions: no React, no window access, so the rules
// (what shows up, what is disabled) are unit-tested. Pane and RecycleBin supply the actions.
import type { MenuEntry } from './ContextMenu'

type Fn = () => void

// ---------- files and folders ----------

export interface ItemMenuCtx {
  count: number
  /** Set when exactly one item is selected. */
  single: { isDir: boolean; pdf?: boolean; zip?: boolean } | null
  canPaste: boolean
  /** Two panes are showing. */
  dual: boolean
  /** The list is showing search results rather than a folder. */
  deep: boolean
}

export interface ItemActions {
  open: Fn
  /** Opens the file in the system's default app (the PDF entry uses it for "Open with default app"). */
  openDefault: Fn
  openOtherPane: Fn
  quickLook: Fn
  cut: Fn
  copy: Fn
  pasteInto: Fn
  rename: Fn
  trash: Fn
  copyPath: Fn
  reveal: Fn
  /** Compress the selection into a .zip next to it. */
  compress: Fn
  extractFolder: Fn
  extractHere: Fn
}

export function itemMenu(c: ItemMenuCtx, a: ItemActions): MenuEntry[] {
  const out: MenuEntry[] = [
    {
      type: 'row',
      buttons: [
        { icon: 'cut', label: 'Cut', shortcut: 'Ctrl+X', onSelect: a.cut },
        { icon: 'copy', label: 'Copy', shortcut: 'Ctrl+C', onSelect: a.copy },
        { icon: 'rename', label: 'Rename', shortcut: 'F2', disabled: c.count !== 1 || c.deep, onSelect: a.rename },
        { icon: 'trash', label: 'Delete', shortcut: 'Del', onSelect: a.trash }
      ]
    }
  ]

  if (c.single) {
    const label = c.deep && !c.single.isDir ? 'Show in folder' : 'Open'
    out.push({ type: 'item', label, icon: 'open', shortcut: 'Enter', bold: true, onSelect: a.open })
    if (c.single.pdf && !c.deep) out.push({ type: 'item', label: 'Open with default app', icon: 'open', onSelect: a.openDefault })
    if (c.single.isDir && c.dual) out.push({ type: 'item', label: 'Open in other pane', icon: 'dual', onSelect: a.openOtherPane })
    if (!c.single.isDir) out.push({ type: 'item', label: 'Quick Look', icon: 'eye', shortcut: 'Space', onSelect: a.quickLook })
    if (c.single.isDir && c.canPaste) out.push({ type: 'item', label: 'Paste into folder', icon: 'paste', onSelect: a.pasteInto })
  }

  out.push({ type: 'sep' })
  if (c.single?.zip) {
    out.push({ type: 'item', label: 'Extract to folder', icon: 'archive', onSelect: a.extractFolder })
    if (!c.deep) out.push({ type: 'item', label: 'Extract here', icon: 'archive', onSelect: a.extractHere })
  }
  out.push({ type: 'item', label: c.count > 1 ? `Compress ${c.count} items to ZIP` : 'Compress to ZIP', icon: 'archive', onSelect: a.compress })
  out.push({ type: 'sep' })
  out.push({ type: 'item', label: 'Copy as path', icon: 'link', shortcut: 'Ctrl+Shift+C', onSelect: a.copyPath })
  if (c.single) out.push({ type: 'item', label: 'Show in Explorer', icon: 'folder', onSelect: a.reveal })
  return out
}

// ---------- empty space in a folder ----------

export interface NewActions {
  newFolder: Fn
  newTextFile: Fn
}

export function newItems(a: NewActions): MenuEntry[] {
  return [
    { type: 'item', label: 'Folder', icon: 'newfolder', shortcut: 'Ctrl+Shift+N', onSelect: a.newFolder },
    { type: 'item', label: 'Text document', icon: 'newfile', onSelect: a.newTextFile }
  ]
}

export interface BackgroundCtx {
  layout: string
  sortKey: string
  sortDir: 'asc' | 'desc'
  canPaste: boolean
}

export interface BackgroundActions extends NewActions {
  setLayout: (id: string) => void
  setSortKey: (key: string) => void
  setSortDir: (dir: 'asc' | 'desc') => void
  refresh: Fn
  paste: Fn
  undo: Fn
  selectAll: Fn
  copyPath: Fn
  openInExplorer: Fn
}

export const LAYOUT_CHOICES: ReadonlyArray<readonly [string, string]> = [
  ['details', 'Details'],
  ['compact', 'Compact list'],
  ['grid', 'Icons']
]
export const SORT_CHOICES: ReadonlyArray<readonly [string, string]> = [
  ['name', 'Name'],
  ['size', 'Size'],
  ['modified', 'Date modified']
]

export function backgroundMenu(c: BackgroundCtx, a: BackgroundActions): MenuEntry[] {
  return [
    {
      type: 'sub',
      label: 'View',
      icon: 'details',
      items: LAYOUT_CHOICES.map(([id, label]) => ({
        type: 'item' as const,
        label,
        checked: c.layout === id,
        onSelect: () => a.setLayout(id)
      }))
    },
    {
      type: 'sub',
      label: 'Sort by',
      icon: 'sort',
      items: [
        ...SORT_CHOICES.map(([key, label]) => ({
          type: 'item' as const,
          label,
          checked: c.sortKey === key,
          onSelect: () => a.setSortKey(key)
        })),
        { type: 'sep' as const },
        { type: 'item' as const, label: 'Ascending', checked: c.sortDir === 'asc', onSelect: () => a.setSortDir('asc') },
        { type: 'item' as const, label: 'Descending', checked: c.sortDir === 'desc', onSelect: () => a.setSortDir('desc') }
      ]
    },
    { type: 'item', label: 'Refresh', icon: 'refresh', shortcut: 'F5', onSelect: a.refresh },
    { type: 'sep' },
    { type: 'item', label: 'Paste', icon: 'paste', shortcut: 'Ctrl+V', disabled: !c.canPaste, onSelect: a.paste },
    { type: 'item', label: 'Undo', icon: 'undo', shortcut: 'Ctrl+Z', onSelect: a.undo },
    { type: 'sep' },
    { type: 'sub', label: 'New', icon: 'plus', items: newItems(a) },
    { type: 'sep' },
    { type: 'item', label: 'Select all', icon: 'selectall', shortcut: 'Ctrl+A', onSelect: a.selectAll },
    { type: 'item', label: 'Copy as path', icon: 'link', onSelect: a.copyPath },
    { type: 'item', label: 'Open in Explorer', icon: 'folder', onSelect: a.openInExplorer }
  ]
}

// ---------- Recycle Bin ----------

export interface BinItemActions {
  restore: Fn
  purge: Fn
  selectAll: Fn
}

export function binItemMenu(count: number, a: BinItemActions): MenuEntry[] {
  return [
    { type: 'item', label: count > 1 ? `Restore ${count.toLocaleString()} items` : 'Restore', icon: 'undo', shortcut: 'Enter', bold: true, onSelect: a.restore },
    { type: 'item', label: 'Delete permanently', icon: 'trash', shortcut: 'Del', onSelect: a.purge },
    { type: 'sep' },
    { type: 'item', label: 'Select all', icon: 'selectall', shortcut: 'Ctrl+A', onSelect: a.selectAll }
  ]
}

export interface BinBackgroundActions {
  empty: Fn
  refresh: Fn
  selectAll: Fn
}

export function binBackgroundMenu(hasItems: boolean, a: BinBackgroundActions): MenuEntry[] {
  return [
    { type: 'item', label: 'Empty Recycle Bin', icon: 'trash', disabled: !hasItems, onSelect: a.empty },
    { type: 'sep' },
    { type: 'item', label: 'Refresh', icon: 'refresh', shortcut: 'F5', onSelect: a.refresh },
    { type: 'item', label: 'Select all', icon: 'selectall', shortcut: 'Ctrl+A', disabled: !hasItems, onSelect: a.selectAll }
  ]
}
