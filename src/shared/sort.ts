import type { FileEntry } from './types.ts'

export type SortKey = 'name' | 'size' | 'modified'

export interface SortState {
  key: SortKey
  dir: 'asc' | 'desc'
}

// One shared collator: far faster than String.localeCompare on tens of thousands of names.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Folders always come first. Ties fall back to name A-Z, whatever the direction. */
export function compareEntries(sort: SortState): (a: FileEntry, b: FileEntry) => number {
  const m = sort.dir === 'asc' ? 1 : -1
  return (a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    let r = 0
    if (sort.key === 'name') r = collator.compare(a.name, b.name)
    else if (sort.key === 'size') r = a.size - b.size
    else r = a.mtimeMs - b.mtimeMs
    return r === 0 ? collator.compare(a.name, b.name) : r * m
  }
}
