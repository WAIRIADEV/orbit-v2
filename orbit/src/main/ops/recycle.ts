import { lstat, mkdir, readdir, readFile, rename, rm, unlink } from 'node:fs/promises'
import { basename, dirname, join, win32 } from 'node:path'
import type { BinEntry, BinList, BinResult } from '../../shared/types.ts'

/**
 * Windows Recycle Bin, read straight from disk (no PowerShell, no COM).
 *
 * Every recycled item is a pair of files in  <drive>:\$Recycle.Bin\<your SID>\ :
 *   $I<id><.ext>  a small record: format version, size, delete time (FILETIME) and the ORIGINAL full path
 *   $R<id><.ext>  the file or folder itself
 * Restoring = move $R back to the original path and drop $I. Deleting for good = remove both.
 *
 * Safety: an id (the $R path) is only accepted if it sits directly inside a bin folder we enumerated
 * ourselves and its name is a plain "$R..." name. Nothing outside the bin can be touched through this API.
 */

export interface BinDeps {
  /** Drive roots that may have a Recycle Bin, e.g. ["C:\\", "D:\\"]. */
  roots: () => Promise<string[]>
  /** The current user's SID (their folder inside $Recycle.Bin), or null if unknown. */
  sid: () => Promise<string | null>
}

const R_NAME = /^\$R[A-Za-z0-9]+(\.[^\\/\0]*)?$/
const MAX_RECORD = 128 * 1024 // a $I record is tiny; refuse anything absurd

export interface BinRecord {
  /** Original full path (a Windows path). */
  original: string
  size: number
  deletedMs: number
}

const EPOCH_DIFF_100NS = 116444736000000000n // 1601-01-01 -> 1970-01-01

/** Parses a $I record. Supports version 1 (Vista-8) and version 2 (Windows 10/11). Returns null if malformed. */
export function parseBinRecord(buf: Buffer): BinRecord | null {
  if (buf.length < 24) return null
  const version = buf.readBigInt64LE(0)
  const size = Number(buf.readBigInt64LE(8))
  const filetime = buf.readBigInt64LE(16)
  let original: string
  if (version === 2n) {
    if (buf.length < 28) return null
    const chars = buf.readInt32LE(24)
    if (chars <= 0 || chars > 32768 || 28 + chars * 2 > buf.length) return null
    original = buf.toString('utf16le', 28, 28 + chars * 2)
  } else if (version === 1n) {
    original = buf.toString('utf16le', 24, Math.min(buf.length, 24 + 520))
  } else {
    return null
  }
  const nul = original.indexOf('\0')
  if (nul >= 0) original = original.slice(0, nul)
  if (original === '') return null
  const deletedMs = filetime > EPOCH_DIFF_100NS ? Number((filetime - EPOCH_DIFF_100NS) / 10000n) : 0
  return { original, size: size >= 0 ? size : 0, deletedMs }
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await lstat(p)).isDirectory()
  } catch {
    return false
  }
}

/** Runs fn over items with at most `limit` in flight (a bin can hold thousands of records). */
async function mapLimit<T, U>(items: T[], limit: number, fn: (item: T) => Promise<U>): Promise<U[]> {
  const out: U[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export class RecycleBinService {
  private readonly deps: BinDeps
  private readonly supported: boolean

  constructor(deps: BinDeps, supported: boolean) {
    this.deps = deps
    this.supported = supported
  }

  /** The bin folders that belong to this user: one per drive that has one. */
  private async binDirs(): Promise<string[]> {
    const [roots, sid] = await Promise.all([this.deps.roots(), this.deps.sid()])
    const dirs: string[] = []
    for (const root of roots) {
      const base = join(root, '$Recycle.Bin')
      if (sid) {
        const mine = join(base, sid)
        if (await isDir(mine)) dirs.push(mine)
        continue
      }
      // SID unknown: take every readable SID folder.
      try {
        for (const n of await readdir(base)) if (n.startsWith('S-') && (await isDir(join(base, n)))) dirs.push(join(base, n))
      } catch {
        /* no bin on this drive, or not readable */
      }
    }
    return dirs
  }

  async list(): Promise<BinList> {
    if (!this.supported) return { supported: false, items: [] }
    try {
      const items = await this.readAll()
      if (items.length === 0) {
        const why = await this.mismatch()
        if (why) return { supported: true, items, error: why }
      }
      return { supported: true, items }
    } catch (e) {
      return { supported: true, items: [], error: (e as Error).message }
    }
  }

  /** An empty list that is really "we are looking in the wrong folder" gets explained instead of looking like an empty bin. */
  private async mismatch(): Promise<string | null> {
    const [roots, sid] = await Promise.all([this.deps.roots(), this.deps.sid()])
    if (!sid) return null
    for (const root of roots) {
      const base = join(root, '$Recycle.Bin')
      if (await isDir(join(base, sid))) continue
      try {
        const others = (await readdir(base)).filter((n) => n.startsWith('S-'))
        if (others.length > 0) return `No Recycle Bin folder for your account (${sid}) on ${root}, but found: ${others.join(', ')}`
      } catch {
        /* nothing readable there */
      }
    }
    return null
  }

  private async readAll(): Promise<BinEntry[]> {
    const items: BinEntry[] = []
    for (const dir of await this.binDirs()) {
      let names: string[]
      try {
        names = await readdir(dir)
      } catch (e) {
        throw new Error(`Can't read ${dir}: ${(e as Error).message}`)
      }
      const records = names.filter((n) => n.startsWith('$I') && n.length > 2)
      const rows = await mapLimit(records, 48, async (iName): Promise<BinEntry | null> => {
        const rName = `$R${iName.slice(2)}`
        const rPath = join(dir, rName)
        try {
          const buf = await readFile(join(dir, iName))
          if (buf.length > MAX_RECORD) return null
          const rec = parseBinRecord(buf)
          if (!rec || !R_NAME.test(rName)) return null
          const st = await lstat(rPath) // an orphan $I (no data file) is not an item
          return {
            id: rPath,
            name: win32.basename(rec.original),
            isDir: st.isDirectory(),
            size: rec.size || (st.isDirectory() ? 0 : st.size),
            deletedMs: rec.deletedMs,
            from: win32.dirname(rec.original)
          }
        } catch {
          return null
        }
      })
      for (const r of rows) if (r) items.push(r)
    }
    return items
  }

  /** Keeps only ids that sit directly in one of our bin folders under a plain $R name; null if any is not. */
  private async checkIds(ids: unknown): Promise<string[] | null> {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100000) return null
    const dirs = new Set((await this.binDirs()).map((d) => d.toLowerCase()))
    for (const id of ids) {
      if (typeof id !== 'string' || id.includes('\0')) return null
      if (!R_NAME.test(basename(id)) || !dirs.has(dirname(id).toLowerCase())) return null
    }
    return ids as string[]
  }

  async restore(ids: unknown): Promise<BinResult> {
    return this.act(ids, 'Restored', 'restore', async (rPath) => {
      const iPath = join(dirname(rPath), `$I${basename(rPath).slice(2)}`)
      const rec = parseBinRecord(await readFile(iPath))
      if (!rec) throw new Error('its record is damaged')
      const dest = rec.original
      if (await lstat(dest).then(() => true, () => false)) throw new Error(`"${win32.basename(dest)}" already exists in ${win32.dirname(dest)}`)
      await mkdir(win32.dirname(dest), { recursive: true }) // the folder it came from may be gone
      await rename(rPath, dest)
      await unlink(iPath).catch(() => undefined)
    })
  }

  async purge(ids: unknown): Promise<BinResult> {
    return this.act(ids, 'Permanently deleted', 'delete', async (rPath) => {
      await rm(rPath, { recursive: true, force: true })
      await unlink(join(dirname(rPath), `$I${basename(rPath).slice(2)}`)).catch(() => undefined)
    })
  }

  async empty(): Promise<BinResult> {
    if (!this.supported) return this.unsupported()
    try {
      const items = await this.readAll()
      if (items.length === 0) return { ok: true, done: 0, message: 'The Recycle Bin is already empty' }
      const r = await this.purge(items.map((i) => i.id))
      return r.ok ? { ok: true, done: r.done, message: 'Recycle Bin emptied' } : r
    } catch (e) {
      return { ok: false, done: 0, message: (e as Error).message }
    }
  }

  private unsupported(): BinResult {
    return { ok: false, done: 0, message: 'The Recycle Bin view is only available on Windows' }
  }

  private async act(ids: unknown, past: string, verb: string, one: (rPath: string) => Promise<void>): Promise<BinResult> {
    if (!this.supported) return this.unsupported()
    let valid: string[] | null
    try {
      valid = await this.checkIds(ids)
    } catch (e) {
      return { ok: false, done: 0, message: (e as Error).message }
    }
    if (!valid) return { ok: false, done: 0, message: 'Refused: not valid Recycle Bin items' }

    let done = 0
    const failed: string[] = []
    for (const id of valid) {
      try {
        await one(id)
        done++
      } catch (e) {
        failed.push(`${verb} failed: ${(e as Error).message}`)
      }
    }
    if (failed.length > 0) {
      return { ok: false, done, message: `Could not ${verb} ${plural(failed.length, 'item')}: ${failed[0]}` }
    }
    return { ok: true, done, message: `${past} ${plural(done, 'item')}` }
  }
}
