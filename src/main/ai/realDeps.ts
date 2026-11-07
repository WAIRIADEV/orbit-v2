import { lstat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { FileEntry } from '../../shared/types.ts'
import { streamDirectory } from '../ops/list.ts'
import { readTextPreview } from '../ops/preview.ts'
import { searchTree } from '../ops/search.ts'
import { readPdfPages } from './pdfRead.ts'
import { realStat, validatePlan } from './plan.ts'
import type { ToolDeps } from './tools.ts'

const SEARCH_MS = 8000
const READ_BYTES = 24 * 1024

/** The tools' view of the real disk. Read-only: nothing here can change a file. */
export function realToolDeps(): ToolDeps {
  return {
    async listDir(path) {
      try {
        const all: FileEntry[] = []
        await streamDirectory(path, (c) => all.push(...c), new AbortController().signal)
        return all
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code
        return { error: code === 'ENOENT' ? `${path} does not exist` : code === 'ENOTDIR' ? `${path} is a file, not a folder` : code === 'EACCES' || code === 'EPERM' ? `No permission to open ${path}` : (e as Error).message }
      }
    },
    async search(root, query, limit) {
      const found: FileEntry[] = []
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), SEARCH_MS)
      try {
        const r = await searchTree(root, query, (c) => found.push(...c), ac.signal, limit)
        return { results: found.slice(0, limit), limited: r.limited || ac.signal.aborted || found.length > limit }
      } catch (e) {
        return { error: (e as Error).message }
      } finally {
        clearTimeout(timer)
      }
    },
    readText: (path) => readTextPreview(path, READ_BYTES),
    async stat(path) {
      try {
        const s = await lstat(path)
        return { name: basename(path), path, isDir: s.isDirectory(), isSymlink: s.isSymbolicLink(), size: s.size, mtimeMs: s.mtimeMs }
      } catch {
        return null
      }
    },
    readPdf: (path, from, to) => readPdfPages(path, from, to),
    validatePlan: (raw) => validatePlan(raw, realStat)
  }
}

