import { opendir, lstat, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { FileEntry } from '../../shared/types.ts'

const CHUNK_SIZE = 200

/**
 * Streams a directory in chunks so the UI can paint the first rows immediately,
 * even for folders with tens of thousands of files. Uses opendir (async iterator)
 * rather than readdir so we never hold the whole listing before sending anything.
 */
export async function streamDirectory(
  dir: string,
  onChunk: (entries: FileEntry[]) => void,
  signal: AbortSignal
): Promise<number> {
  const handle = await opendir(dir)
  let total = 0
  let batch: import('node:fs').Dirent[] = []

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return
    const current = batch
    batch = []
    // Stat each chunk in parallel; failures (permissions, races) degrade to size 0.
    const entries = await Promise.all(current.map((d) => toEntry(dir, d)))
    total += entries.length
    if (!signal.aborted) onChunk(entries)
  }

  try {
    for await (const dirent of handle) {
      if (signal.aborted) break
      batch.push(dirent)
      if (batch.length >= CHUNK_SIZE) await flush()
    }
    if (!signal.aborted) await flush()
  } finally {
    // opendir handle closes itself when the iterator finishes; on early break it needs closing.
    await handle.close().catch(() => {})
  }
  return total
}

export async function toEntry(dir: string, d: import('node:fs').Dirent): Promise<FileEntry> {
  const path = join(dir, d.name)
  const isSymlink = d.isSymbolicLink()
  let isDir = d.isDirectory()
  let size = 0
  let mtimeMs = 0
  try {
    const s = isSymlink ? await stat(path).catch(() => lstat(path)) : await lstat(path)
    size = s.isDirectory() ? 0 : s.size
    mtimeMs = s.mtimeMs
    if (isSymlink) isDir = s.isDirectory()
  } catch {
    // keep defaults
  }
  return { name: d.name, path, isDir, isSymlink, size, mtimeMs }
}
