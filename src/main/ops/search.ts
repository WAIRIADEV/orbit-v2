import { opendir } from 'node:fs/promises'
import { join } from 'node:path'
import type { FileEntry } from '../../shared/types.ts'
import { toEntry } from './list.ts'

const MAX_RESULTS = 5000
const FLUSH_COUNT = 50
const FLUSH_MS = 150
const YIELD_EVERY = 400

// System folders that are slow, locked, or never what the user is looking for.
const SKIP_DIRS = new Set(['$recycle.bin', 'system volume information', '$windows.~bt', '$windows.~ws'])

export interface SearchResult {
  total: number
  limited: boolean
}

/**
 * Breadth-first name search under `root`. Shallow matches arrive first, which is usually what you want.
 * Space-separated words must ALL appear in the name (case-insensitive): "report final" finds "final_report.docx".
 * Never follows symlinked folders (no loops), silently skips folders it cannot read, yields to the
 * event loop regularly so the app stays responsive, streams results in chunks, and stops on abort.
 */
export async function searchTree(
  root: string,
  query: string,
  onChunk: (entries: FileEntry[]) => void,
  signal: AbortSignal,
  maxResults: number = MAX_RESULTS
): Promise<SearchResult> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return { total: 0, limited: false }

  const queue: string[] = [root]
  let head = 0
  let total = 0
  let limited = false
  let seen = 0
  let lastFlush = Date.now()
  let pending: Array<{ dir: string; dirent: import('node:fs').Dirent }> = []

  const flush = async (): Promise<void> => {
    if (pending.length === 0) return
    const batch = pending
    pending = []
    lastFlush = Date.now()
    const entries = await Promise.all(batch.map((m) => toEntry(m.dir, m.dirent)))
    if (!signal.aborted) onChunk(entries)
  }

  outer: while (head < queue.length && !signal.aborted) {
    const dir = queue[head++] as string
    let handle
    try {
      handle = await opendir(dir)
    } catch {
      continue // permission denied, vanished, not a folder
    }

    try {
      for await (const dirent of handle) {
        if (signal.aborted) break outer
        const lower = dirent.name.toLowerCase()

        if (dirent.isDirectory() && !dirent.isSymbolicLink() && !SKIP_DIRS.has(lower)) {
          queue.push(join(dir, dirent.name))
        }

        if (terms.every((t) => lower.includes(t))) {
          pending.push({ dir, dirent })
          total++
          if (total >= maxResults) {
            limited = true
            break outer
          }
        }

        if (++seen % YIELD_EVERY === 0) {
          if (pending.length >= FLUSH_COUNT || Date.now() - lastFlush >= FLUSH_MS) await flush()
          await new Promise<void>((resolve) => setImmediate(resolve))
        } else if (pending.length >= FLUSH_COUNT) {
          await flush()
        }
      }
    } catch {
      // folder became unreadable mid-scan: move on
    } finally {
      await handle.close().catch(() => {})
    }
  }

  if (!signal.aborted) await flush()
  return { total, limited }
}
