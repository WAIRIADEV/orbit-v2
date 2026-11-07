import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Produces PNG bytes for a file, or null when it can't (unsupported type, corrupt file). */
export type GenerateFn = (path: string, px: number) => Promise<Buffer | null>

export interface ThumbOptions {
  cacheDir: string
  generate: GenerateFn
  px?: number
  /** How many thumbnails may be generated at once. */
  concurrency?: number
  /** The cache is trimmed (oldest first) when it grows past this. */
  maxCacheBytes?: number
}

/**
 * Thumbnails with a disk cache, a small worker limit and request de-duplication.
 * - Cache key = path + mtime + size + pixel size, so an edited file gets a fresh thumbnail.
 * - Requests that were cancelled (the tile scrolled out of view) before they started never run.
 * - A file that failed once is not retried until it changes.
 */
export class ThumbnailService {
  private readonly cacheDir: string
  private readonly generate: GenerateFn
  private readonly px: number
  private readonly limit: number
  private readonly maxBytes: number
  private running = 0
  private readonly waiting: Array<() => void> = []
  private readonly inflight = new Map<string, { promise: Promise<string | null>; refs: number }>()
  private readonly failed = new Set<string>()
  private writes = 0
  private ready: Promise<void> | null = null

  constructor(opts: ThumbOptions) {
    this.cacheDir = opts.cacheDir
    this.generate = opts.generate
    this.px = opts.px ?? 256
    this.limit = opts.concurrency ?? 3
    this.maxBytes = opts.maxCacheBytes ?? 200 * 1024 * 1024
  }

  /** Resolves to the path of a cached PNG, or null if no thumbnail can be made. */
  async get(path: string, signal?: AbortSignal): Promise<string | null> {
    let st
    try {
      st = await stat(path)
    } catch {
      return null
    }
    if (!st.isFile()) return null
    const key = createHash('sha1').update(`${path}|${st.mtimeMs}|${st.size}|${this.px}`).digest('hex')
    if (this.failed.has(key)) return null
    const file = join(this.cacheDir, `${key}.png`)

    this.ready ??= mkdir(this.cacheDir, { recursive: true }).then(() => undefined)
    await this.ready

    try {
      await stat(file)
      return file // cache hit
    } catch {
      /* miss: generate below */
    }

    let job = this.inflight.get(key)
    if (!job) {
      const created = { promise: null as unknown as Promise<string | null>, refs: 0 }
      created.promise = this.make(path, key, file, () => created.refs).finally(() => this.inflight.delete(key))
      this.inflight.set(key, created)
      job = created
    }
    job.refs++
    if (!signal) return job.promise
    // Each caller can stop waiting on its own; the shared job keeps going while anyone still wants it.
    const mine = job
    return raceAbort(mine.promise, signal, () => mine.refs--)
  }

  private async make(path: string, key: string, file: string, refs: () => number): Promise<string | null> {
    await this.slot()
    try {
      if (refs() <= 0) return null // everyone who wanted it scrolled away while it waited in line
      const png = await this.generate(path, this.px)
      if (!png || png.length === 0) {
        this.failed.add(key)
        return null
      }
      const tmp = `${file}.${process.pid}.tmp`
      await writeFile(tmp, png)
      await rename(tmp, file) // atomic: a half-written file is never served
      if (++this.writes % 200 === 0) void this.prune().catch(() => {})
      return file
    } catch {
      this.failed.add(key)
      return null
    } finally {
      this.release()
    }
  }

  private slot(): Promise<void> {
    if (this.running < this.limit) {
      this.running++
      return Promise.resolve()
    }
    return new Promise((resolve) => this.waiting.push(() => resolve()))
  }

  private release(): void {
    const next = this.waiting.shift()
    if (next) next() // hand the slot straight over
    else this.running--
  }

  /** Deletes the oldest cached thumbnails until the cache fits in maxCacheBytes. */
  async prune(): Promise<number> {
    const names = (await readdir(this.cacheDir)).filter((n) => n.endsWith('.png'))
    const files = (
      await Promise.all(
        names.map(async (n) => {
          try {
            const s = await stat(join(this.cacheDir, n))
            return { n, size: s.size, t: s.mtimeMs }
          } catch {
            return null
          }
        })
      )
    ).filter((f): f is { n: string; size: number; t: number } => f !== null)
    let total = files.reduce((a, f) => a + f.size, 0)
    let removed = 0
    for (const f of files.sort((a, b) => a.t - b.t)) {
      if (total <= this.maxBytes) break
      await unlink(join(this.cacheDir, f.n)).catch(() => {})
      total -= f.size
      removed++
    }
    return removed
  }

  /** Test helper: reads a cached file. */
  static read(file: string): Promise<Buffer> {
    return readFile(file)
  }
}

function raceAbort<T>(p: Promise<T>, signal: AbortSignal, onCancel: () => void): Promise<T | null> {
  if (signal.aborted) {
    onCancel()
    return Promise.resolve(null)
  }
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      onCancel()
      resolve(null)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort)
        resolve(v)
      },
      (e) => {
        signal.removeEventListener('abort', onAbort)
        reject(e)
      }
    )
  })
}
