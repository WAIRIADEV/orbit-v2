import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, readdir, rename, rm, access, rmdir, unlink } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import yauzl from 'yauzl'
import yazl from 'yazl'
import { isInside } from '../../shared/dnd.ts'

export interface ZipProgress {
  /** 0..100 */
  percent: number
  current?: string
}
type OnProgress = (p: ZipProgress) => void

const ALREADY_PACKED = new Set(['.zip', '.7z', '.rar', '.gz', '.bz2', '.xz', '.zst', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.avif', '.mp3', '.aac', '.m4a', '.ogg', '.flac', '.opus', '.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v', '.docx', '.xlsx', '.pptx', '.jar', '.apk'])
export const MAX_EXTRACT_BYTES = 200 * 1024 ** 3
export const MAX_ENTRIES = 500_000

function abortError(): Error {
  return Object.assign(new Error('Cancelled'), { name: 'AbortError' })
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/** "a.zip" -> "a (1).zip" -> "a (2).zip" (same rule the copy and move operations use). */
async function uniquePath(p: string): Promise<string> {
  if (!(await exists(p))) return p
  const ext = extname(p)
  const base = basename(p, ext)
  for (let i = 1; ; i++) {
    const c = join(dirname(p), `${base} (${i})${ext}`)
    if (!(await exists(c))) return c
  }
}

// ---------------------------------------------------------------- compress

interface PlanFile {
  real: string
  name: string
  size: number
  mtime: Date
  mode: number
}
interface PlanDir {
  name: string
  mtime: Date
}

/** Walks the sources into a flat list. Symbolic links are skipped (never followed out of the folder). */
async function planZip(sources: string[], skip: string, signal: AbortSignal): Promise<{ files: PlanFile[]; dirs: PlanDir[]; skipped: number }> {
  const files: PlanFile[] = []
  const dirs: PlanDir[] = []
  let skipped = 0
  const walk = async (real: string, name: string): Promise<void> => {
    if (signal.aborted) throw abortError()
    const st = await lstat(real)
    if (st.isSymbolicLink()) {
      skipped++
      return
    }
    if (st.isDirectory()) {
      const kids = await readdir(real)
      if (kids.length === 0) dirs.push({ name: `${name}/`, mtime: st.mtime })
      for (const k of kids) await walk(join(real, k), `${name}/${k}`)
    } else if (st.isFile()) {
      if (real === skip) return // never put the archive inside itself
      files.push({ real, name, size: st.size, mtime: st.mtime, mode: st.mode & 0o777 || 0o644 })
    } else skipped++
  }
  for (const s of sources) await walk(s, basename(s))
  return { files, dirs, skipped }
}

/**
 * Writes `dest` (a .zip) from the sources. Streams file by file, so memory stays flat for any size.
 * Written to `dest.partial` first and renamed at the end, so a cancel or crash never leaves a broken .zip.
 */
export async function createZip(sources: string[], dest: string, signal: AbortSignal, onProgress: OnProgress = () => undefined): Promise<{ files: number; skipped: number }> {
  const partial = `${dest}.partial`
  const plan = await planZip(sources, dest, signal)
  const total = plan.files.reduce((n, f) => n + f.size, 0) || 1
  let done = 0
  let lastPct = -1
  const report = (current?: string): void => {
    const pct = Math.min(100, Math.floor((done / total) * 100))
    if (pct !== lastPct || current) {
      lastPct = pct
      onProgress({ percent: pct, ...(current ? { current } : {}) })
    }
  }

  const zip = new yazl.ZipFile()
  for (const d of plan.dirs) zip.addEmptyDirectory(d.name, { mtime: d.mtime })
  for (const f of plan.files) {
    const compress = !ALREADY_PACKED.has(extname(f.name).toLowerCase())
    zip.addReadStreamLazy(f.name, { mtime: f.mtime, mode: f.mode, compress, size: f.size }, (cb) => {
      if (signal.aborted) return cb(abortError(), undefined as never)
      report(basename(f.name))
      const counter = new Transform({
        transform(chunk: Buffer, _enc, next) {
          done += chunk.length
          report()
          next(null, chunk)
        }
      })
      const src = createReadStream(f.real)
      src.on('error', (e) => counter.destroy(e))
      cb(null, src.pipe(counter))
    })
  }
  zip.end()

  try {
    await mkdir(dirname(dest), { recursive: true })
    const out = createWriteStream(partial, { flags: 'wx' })
    const onAbort = (): void => {
      out.destroy(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      await pipeline(zip.outputStream as NodeJS.ReadableStream, out)
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
    if (signal.aborted) throw abortError()
    await rename(partial, dest)
  } catch (e) {
    await rm(partial, { force: true })
    throw e
  }
  onProgress({ percent: 100 })
  return { files: plan.files.length, skipped: plan.skipped }
}

// ---------------------------------------------------------------- extract

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/**
 * Turns an entry name from an archive into safe path segments for Windows, or null if it tries to escape the
 * destination (absolute path, drive letter, "..") which makes the whole archive untrustworthy.
 */
export function safeSegments(entryName: string): string[] | null {
  if (!entryName || entryName.includes('\0')) return null
  const n = entryName.replace(/\\/g, '/')
  if (n.startsWith('/') || /^[a-z]:/i.test(n)) return null
  const out: string[] = []
  for (const raw of n.split('/')) {
    if (raw === '' || raw === '.') continue
    if (raw === '..') return null
    let seg = raw.replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '')
    if (seg === '') seg = '_'
    if (RESERVED.test(seg)) seg = `_${seg}`
    out.push(seg)
  }
  return out.length > 0 ? out : null
}

export class ZipError extends Error {}

interface Entry {
  segs: string[]
  isDir: boolean
  size: number
  index: number
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (err, zf) => (err || !zf ? reject(err ?? new Error('Cannot open archive')) : resolve(zf)))
  })
}

/** Reads the directory of the archive only (cheap), and refuses archives that are unsafe or unsupported. */
async function scan(zipPath: string, maxBytes: number): Promise<{ entries: Entry[]; total: number }> {
  const entries: Entry[] = []
  let total = 0
  let zf: yauzl.ZipFile | undefined
  try {
    zf = await openZip(zipPath)
    const z = zf
    await new Promise<void>((resolve, reject) => {
      let i = 0
      z.on('error', reject)
      z.on('end', resolve)
      z.on('entry', (e: yauzl.Entry) => {
        if (entries.length >= MAX_ENTRIES) return reject(new ZipError('This archive has too many files to extract here.'))
        if (e.isEncrypted()) return reject(new ZipError('This ZIP is password protected. ORBIT cannot open encrypted ZIP files yet.'))
        const isDir = e.fileName.endsWith('/')
        if (!isDir && e.compressionMethod !== 0 && e.compressionMethod !== 8) return reject(new ZipError('This ZIP uses a compression method ORBIT does not support.'))
        const mode = (e.externalFileAttributes >>> 16) & 0o170000
        if (mode === 0o120000) {
          z.readEntry() // a symbolic link: never created
          return
        }
        const segs = safeSegments(e.fileName)
        if (!segs) return reject(new ZipError(`This archive contains an unsafe path (“${e.fileName.slice(0, 60)}”), so it was not extracted.`))
        total += e.uncompressedSize
        if (total > maxBytes) return reject(new ZipError('This archive would expand to an unreasonable size, so it was not extracted.'))
        entries.push({ segs, isDir, size: e.uncompressedSize, index: i++ })
        z.readEntry()
      })
      z.readEntry()
    })
  } catch (e) {
    if (e instanceof ZipError) throw e
    const m = (e as Error).message
    if (/invalid relative path|absolute path|invalid characters/i.test(m)) throw new ZipError('This archive contains paths ORBIT will not extract (unsafe or unsupported names).')
    throw new ZipError(/end of central directory|not a zip|signature/i.test(m) ? 'This is not a valid ZIP file, or it is damaged.' : m)
  } finally {
    zf?.close()
  }
  return { entries, total }
}

/** Removes what an extraction created: files first, then folders that are empty. Anything else is left alone. */
export async function removeCreated(created: string[]): Promise<void> {
  for (const p of [...created].reverse()) {
    try {
      await unlink(p)
    } catch {
      await rmdir(p).catch(() => undefined) // a folder: only if empty, so work added since is never lost
    }
  }
}

export interface ExtractResult {
  files: number
  /** Everything that was created (folders first), for undo. */
  created: string[]
  /** The top-level items that now exist in the destination. */
  topLevel: string[]
}

/**
 * Extracts into `destDir`. Never overwrites: a top-level name that already exists becomes "name (1)", and a
 * duplicate entry inside the archive gets a numbered name too. Symbolic links and unsafe paths are never created.
 */
export async function extractZip(zipPath: string, destDir: string, signal: AbortSignal, onProgress: OnProgress = () => undefined, maxBytes = MAX_EXTRACT_BYTES): Promise<ExtractResult> {
  const { entries, total } = await scan(zipPath, maxBytes)
  await mkdir(destDir, { recursive: true })

  // Choose the final name of each top-level item once, so all its children follow it.
  const top = new Map<string, string>()
  for (const e of entries) {
    const first = e.segs[0] as string
    if (!top.has(first)) top.set(first, basename(await uniquePath(join(destDir, first))))
    // reserve it so a second archive item with a case-variant name does not collide
  }
  const created: string[] = []
  const made = new Set<string>()
  const ensureDir = async (dir: string): Promise<void> => {
    if (made.has(dir)) return
    const missing: string[] = []
    for (let d = dir; !made.has(d) && d !== destDir && isInside(d, destDir) && !(await exists(d)); d = dirname(d)) missing.unshift(d)
    await mkdir(dir, { recursive: true })
    for (const m of missing) created.push(m)
    made.add(dir)
  }

  const zf = await openZip(zipPath)
  let done = 0
  let lastPct = -1
  const report = (current?: string): void => {
    const pct = Math.min(100, Math.floor((done / (total || 1)) * 100))
    if (pct !== lastPct || current) {
      lastPct = pct
      onProgress({ percent: pct, ...(current ? { current } : {}) })
    }
  }

  try {
    await new Promise<void>((resolve, reject) => {
      zf.on('error', reject)
      zf.on('end', resolve)
      const fail = (e: unknown): void => reject(e)
      zf.on('entry', (e: yauzl.Entry) => {
        void (async () => {
          if (signal.aborted) throw abortError()
          const segs = safeSegments(e.fileName)
          const mode = (e.externalFileAttributes >>> 16) & 0o170000
          if (!segs || mode === 0o120000) return zf.readEntry()
          const mapped = [top.get(segs[0] as string) ?? (segs[0] as string), ...segs.slice(1)]
          const target = join(destDir, ...mapped)
          if (!isInside(target, destDir)) throw new ZipError('This archive tried to write outside the destination, so it was stopped.')
          if (e.fileName.endsWith('/')) {
            await ensureDir(target)
            return zf.readEntry()
          }
          await ensureDir(dirname(target))
          report(basename(target))
          const stream = await new Promise<NodeJS.ReadableStream>((res, rej) => zf.openReadStream(e, (err, s) => (err || !s ? rej(err ?? new Error('Cannot read entry')) : res(s))))
          let finalPath = target
          let out
          for (let n = 1; ; n++) {
            try {
              out = createWriteStream(finalPath, { flags: 'wx' }) // wx: never overwrite
              await new Promise<void>((res, rej) => {
                out!.once('open', () => res())
                out!.once('error', rej)
              })
              break
            } catch (err) {
              if ((err as NodeJS.ErrnoException).code !== 'EEXIST' || n > 1000) throw err
              const ext = extname(target)
              finalPath = join(dirname(target), `${basename(target, ext)} (${n})${ext}`)
            }
          }
          created.push(finalPath)
          const counter = new Transform({
            transform(chunk: Buffer, _enc, next) {
              done += chunk.length
              report()
              next(null, chunk)
            }
          })
          const onAbort = (): void => {
            out.destroy(abortError())
          }
          signal.addEventListener('abort', onAbort, { once: true })
          try {
            await pipeline(stream, counter, out)
          } finally {
            signal.removeEventListener('abort', onAbort)
          }
          zf.readEntry()
        })().catch(fail)
      })
      zf.readEntry()
    })
  } catch (e) {
    // Leave nothing half-written behind: remove what this run created (files first, then empty folders).
    await removeCreated(created)
    throw e
  } finally {
    zf.close()
  }
  onProgress({ percent: 100 })
  return { files: entries.filter((e) => !e.isDir).length, created, topLevel: [...top.values()].map((n) => join(destDir, n)) }
}
