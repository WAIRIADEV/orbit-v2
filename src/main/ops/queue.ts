import { cp, mkdir, rename, rm, rmdir, stat, access, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type { OpProgress, OpRequest, UndoResult } from '../../shared/types.ts'
import { isInside, samePath } from '../../shared/dnd.ts'
import { createZip, extractZip, removeCreated, ZipError, type ZipProgress } from './zip.ts'

type TrashFn = (path: string) => Promise<void>

interface UndoRecord {
  description: string
  run: () => Promise<void>
}

interface Job {
  id: number
  req: OpRequest
  progress: OpProgress
  controller: AbortController
}

/**
 * One queue for every file operation. Jobs run one at a time (disk-friendly),
 * report progress, can be cancelled, and record how to undo themselves.
 *
 * Delete goes through the injected trash function (Electron's shell.trashItem),
 * so the OS Recycle Bin is the single source of truth. No custom bin to keep in sync.
 */
export class OperationQueue {
  private nextId = 1
  private jobs: Job[] = []
  private running = false
  private current: Job | null = null
  private undoStack: UndoRecord[] = []

  private readonly trash: TrashFn
  private readonly emit: (p: OpProgress) => void

  constructor(trash: TrashFn, emit: (p: OpProgress) => void) {
    this.trash = trash
    this.emit = emit
  }

  enqueue(req: OpRequest): number {
    const id = this.nextId++
    const job: Job = {
      id,
      req,
      controller: new AbortController(),
      progress: { id, kind: req.kind, status: 'queued', done: 0, total: Math.max(1, req.sources.length) }
    }
    this.jobs.push(job)
    this.emit({ ...job.progress })
    void this.pump()
    return id
  }

  cancel(id: number): void {
    const job = this.current?.id === id ? this.current : this.jobs.find((j) => j.id === id)
    if (!job) return
    job.controller.abort()
    if (job.progress.status === 'queued') this.finish(job, 'cancelled')
  }

  async undo(): Promise<UndoResult> {
    const rec = this.undoStack.pop()
    if (!rec) return { ok: false, message: 'Nothing to undo' }
    try {
      await rec.run()
      return { ok: true, message: `Undid: ${rec.description}` }
    } catch (e) {
      return { ok: false, message: `Undo failed: ${(e as Error).message}` }
    }
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (let job = this.jobs.shift(); job; job = this.jobs.shift()) {
        if (job.progress.status === 'cancelled') continue
        this.current = job
        try {
          await this.run(job)
        } finally {
          this.current = null
        }
      }
    } finally {
      this.running = false
    }
  }

  private async run(job: Job): Promise<void> {
    job.progress.status = 'running'
    this.emit({ ...job.progress })
    const { req, controller } = job

    try {
      switch (req.kind) {
        case 'rename': {
          const src = req.sources[0]
          if (!src || !req.target) throw new Error('rename needs one source and a new name')
          assertValidName(req.target)
          const dest = join(dirname(src), req.target)
          if (await exists(dest)) throw new Error(`"${req.target}" already exists`)
          await rename(src, dest)
          this.undoStack.push({
            description: `rename ${basename(src)}`,
            run: () => rename(dest, src)
          })
          job.progress.done = 1
          break
        }
        case 'mkdir':
        case 'newfile': {
          const dir = req.target
          if (!dir) throw new Error('Nothing to create it in')
          const isDir = req.kind === 'mkdir'
          const name = req.name ?? (isDir ? 'New folder' : 'New Text Document.txt')
          assertValidName(name)
          const path = await uniquePath(join(dir, name))
          if (isDir) await mkdir(path)
          else await writeFile(path, '', { flag: 'wx' }) // wx: never overwrite, even if it appeared a moment ago
          job.progress.created = path
          job.progress.done = 1
          this.undoStack.push({
            description: `create ${basename(path)}`,
            // Only removes what is still empty, so undo can never delete work that was added since.
            run: async () => {
              if (isDir) await rmdir(path)
              else if ((await stat(path)).size === 0) await rm(path)
              else throw new Error(`${basename(path)} is no longer empty`)
            }
          })
          break
        }
        case 'trash': {
          for (const src of req.sources) {
            if (controller.signal.aborted) break
            job.progress.current = basename(src)
            await this.trash(src)
            job.progress.done++
            this.emit({ ...job.progress })
          }
          // Restoring from the OS Recycle Bin is done there; we do not fake an undo.
          break
        }
        case 'zip': {
          const first = req.sources[0]
          if (!first) throw new Error('Nothing to compress')
          const dir = req.target ?? dirname(first)
          const base = req.sources.length === 1 ? basename(first) : 'Archive'
          const dest = await uniquePath(join(dir, `${base}.zip`))
          await createZip(req.sources, dest, controller.signal, this.zipProgress(job))
          job.progress.created = dest
          job.progress.done = job.progress.total
          this.undoStack.push({
            description: `compress to ${basename(dest)}`,
            run: () => rm(dest, { force: true })
          })
          break
        }
        case 'unzip': {
          const zip = req.sources[0]
          if (!zip) throw new Error('Nothing to extract')
          const here = dirname(zip)
          const out = req.mode === 'here' ? here : await uniquePath(join(here, basename(zip, extname(zip))))
          const r = await extractZip(zip, out, controller.signal, this.zipProgress(job))
          job.progress.created = r.topLevel.length === 1 && req.mode === 'here' ? (r.topLevel[0] as string) : out
          job.progress.done = job.progress.total
          if (!controller.signal.aborted) {
            this.undoStack.push({
              description: `extract ${basename(zip)}`,
              run: async () => {
                await removeCreated(r.created)
                if (req.mode !== 'here') await rmdir(out).catch(() => undefined)
              }
            })
          }
          break
        }
        case 'copy':
        case 'move': {
          if (!req.target) throw new Error(`${req.kind} needs a destination folder`)
          const target = req.target
          // Validate everything BEFORE touching anything, so a bad drop never leaves half the work done.
          for (const src of req.sources) {
            if (samePath(src, target) || isInside(target, src)) {
              throw new Error(`Cannot ${req.kind} "${basename(src)}" into itself`)
            }
          }
          // Moving an item into the folder it is already in would just rename it to "name (1)": skip those.
          const items =
            req.kind === 'move' ? req.sources.filter((s) => !samePath(dirname(s), target)) : req.sources
          job.progress.done += req.sources.length - items.length
          const moved: Array<{ from: string; to: string }> = []
          const created: string[] = []
          for (const src of items) {
            if (controller.signal.aborted) break
            job.progress.current = basename(src)
            this.emit({ ...job.progress })
            const dest = await uniquePath(join(req.target, basename(src)))
            if (req.kind === 'copy') {
              await cp(src, dest, { recursive: true, errorOnExist: true, force: false })
              created.push(dest)
            } else {
              await moveAcrossDevices(src, dest)
              moved.push({ from: src, to: dest })
            }
            job.progress.done++
          }
          if (created.length) {
            this.undoStack.push({
              description: `copy ${created.length} item(s)`,
              run: async () => {
                for (const p of created) await rm(p, { recursive: true, force: true })
              }
            })
          }
          if (moved.length) {
            this.undoStack.push({
              description: `move ${moved.length} item(s)`,
              run: async () => {
                for (const m of moved.reverse()) await moveAcrossDevices(m.to, m.from)
              }
            })
          }
          break
        }
      }
      this.finish(job, controller.signal.aborted ? 'cancelled' : 'done')
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        delete job.progress.created
        this.finish(job, 'cancelled')
        return
      }
      job.progress.error = e instanceof ZipError ? e.message : (e as Error).message
      this.finish(job, 'failed')
    }
  }

  /** Progress callback for zip/unzip: percent + current file, emitted at most ~10 times a second. */
  private zipProgress(job: Job): (p: ZipProgress) => void {
    let last = 0
    return (p) => {
      job.progress.percent = Math.round(p.percent)
      if (p.current) job.progress.current = p.current
      const now = Date.now()
      if (p.percent >= 100 || now - last >= 100) {
        last = now
        this.emit({ ...job.progress })
      }
    }
  }

  private finish(job: Job, status: OpProgress['status']): void {
    job.progress.status = status
    delete job.progress.current
    this.emit({ ...job.progress })
  }
}

/** Rejects names that would escape the folder or that Windows can't store. */
export function assertValidName(name: string): void {
  if (!name || name !== name.trim() || name === '.' || name === '..') throw new Error('That name is not allowed')
  if (/[\\/:*?"<>|\0]/.test(name)) throw new Error('A name can’t contain any of these: \\ / : * ? " < > |')
  if (/[. ]$/.test(name)) throw new Error('A name can’t end with a dot or a space')
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name)) throw new Error(`“${name}” is a reserved name`)
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/** "report.pdf" -> "report (1).pdf" -> "report (2).pdf" ... */
export async function uniquePath(p: string): Promise<string> {
  if (!(await exists(p))) return p
  const dir = dirname(p)
  const ext = extname(p)
  const base = basename(p, ext)
  for (let i = 1; ; i++) {
    const candidate = join(dir, `${base} (${i})${ext}`)
    if (!(await exists(candidate))) return candidate
  }
}

/** rename() is instant on one volume; across volumes it throws EXDEV, so fall back to copy + delete. */
async function moveAcrossDevices(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    await cp(from, to, { recursive: true, errorOnExist: true, force: false })
    await stat(to) // make sure the copy landed before deleting the source
    await rm(from, { recursive: true, force: true })
  }
}
