import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AiPlan, PlanAction } from '../../shared/types.ts'
import { MAX_ACTIONS, MAX_PATHS_PER_ACTION } from '../../shared/aiPlan.ts'
import { parentPath } from '../../shared/paths.ts'
import { assertValidName } from '../ops/queue.ts'

const ABSOLUTE = /^([a-z]:[\\/]|\\\\|\/)/i

export type Kind = 'dir' | 'file' | null
export type StatFn = (path: string) => Promise<Kind>

export const realStat: StatFn = async (p) => {
  try {
    return (await stat(p)).isDirectory() ? 'dir' : 'file'
  } catch {
    return null
  }
}

export type PlanResult = { ok: true; plan: AiPlan } | { ok: false; error: string }

const norm = (p: string): string => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
const abs = (p: unknown): p is string => typeof p === 'string' && p.length > 0 && !p.includes('\0') && ABSOLUTE.test(p)

/**
 * Checks a plan the model proposed, against the real disk, BEFORE the person sees it. The model is never trusted:
 * every path must exist (or be created earlier in the same plan), names must be legal, nothing may land in itself,
 * and the only way to remove something is the Recycle Bin. Errors are written for the model so it can fix and retry.
 */
export async function validatePlan(raw: unknown, statFn: StatFn = realStat): Promise<PlanResult> {
  const fail = (error: string): PlanResult => ({ ok: false, error })
  if (typeof raw !== 'object' || raw === null) return fail('propose_changes needs an object with title and actions')
  const r = raw as { title?: unknown; actions?: unknown }
  const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim().slice(0, 120) : 'Proposed changes'
  if (!Array.isArray(r.actions) || r.actions.length === 0) return fail('actions must be a non-empty array')
  if (r.actions.length > MAX_ACTIONS) return fail(`Too many actions (max ${MAX_ACTIONS}). Propose the first batch only.`)

  const created = new Set<string>() // folders made earlier in this plan
  const gone = new Set<string>() // paths moved or trashed earlier in this plan
  const actions: PlanAction[] = []

  const dirOk = async (p: string): Promise<boolean> => created.has(norm(p)) || (await statFn(p)) === 'dir'
  const pathsOf = (v: unknown, what: string): string[] | string => {
    if (!Array.isArray(v) || v.length === 0) return `${what}: paths must be a non-empty array`
    if (v.length > MAX_PATHS_PER_ACTION) return `${what}: too many paths (max ${MAX_PATHS_PER_ACTION})`
    for (const p of v) if (!abs(p)) return `${what}: "${String(p)}" is not an absolute path`
    return v as string[]
  }

  for (const [i, a0] of r.actions.entries()) {
    const n = `Action ${i + 1}`
    const a = a0 as Record<string, unknown> | null
    if (typeof a !== 'object' || a === null) return fail(`${n}: not an object`)
    switch (a['type']) {
      case 'mkdir': {
        const { parent, name } = a
        if (!abs(parent)) return fail(`${n} (mkdir): parent must be an absolute path`)
        if (typeof name !== 'string') return fail(`${n} (mkdir): name is required`)
        try {
          assertValidName(name)
        } catch (e) {
          return fail(`${n} (mkdir): ${(e as Error).message}`)
        }
        if (!(await dirOk(parent))) return fail(`${n} (mkdir): parent folder "${parent}" does not exist`)
        const full = join(parent, name)
        if (created.has(norm(full)) || (await statFn(full)) !== null) return fail(`${n} (mkdir): "${full}" already exists. Use it directly instead of creating it.`)
        created.add(norm(full))
        actions.push({ type: 'mkdir', parent, name })
        break
      }
      case 'move':
      case 'copy': {
        const paths = pathsOf(a['paths'], `${n} (${String(a['type'])})`)
        if (typeof paths === 'string') return fail(paths)
        const to = a['to']
        if (!abs(to)) return fail(`${n}: "to" must be an absolute folder path`)
        if (!(await dirOk(to))) return fail(`${n}: destination folder "${to}" does not exist. Add a mkdir action before it.`)
        for (const p of paths) {
          if (gone.has(norm(p))) return fail(`${n}: "${p}" was already moved or removed earlier in this plan`)
          if ((await statFn(p)) === null) return fail(`${n}: "${p}" does not exist. Check the exact name with list_folder.`)
          const np = norm(p)
          const nt = norm(to)
          if (nt === np || nt.startsWith(`${np}\\`)) return fail(`${n}: cannot put "${p}" inside itself`)
        }
        if (a['type'] === 'move') for (const p of paths) gone.add(norm(p))
        actions.push({ type: a['type'], paths, to })
        break
      }
      case 'rename': {
        const { path, newName } = a
        if (!abs(path)) return fail(`${n} (rename): path must be absolute`)
        if (typeof newName !== 'string') return fail(`${n} (rename): newName is required`)
        try {
          assertValidName(newName)
        } catch (e) {
          return fail(`${n} (rename): ${(e as Error).message}`)
        }
        if (gone.has(norm(path))) return fail(`${n} (rename): "${path}" was already moved or removed earlier in this plan`)
        if ((await statFn(path)) === null) return fail(`${n} (rename): "${path}" does not exist`)
        const dest = join(parentPath(path), newName) // not join(path, '..'): that misreads backslash paths off Windows
        if ((await statFn(dest)) !== null) return fail(`${n} (rename): "${newName}" already exists in that folder`)
        gone.add(norm(path))
        actions.push({ type: 'rename', path, newName })
        break
      }
      case 'trash': {
        const paths = pathsOf(a['paths'], `${n} (trash)`)
        if (typeof paths === 'string') return fail(paths)
        for (const p of paths) {
          if (gone.has(norm(p))) return fail(`${n}: "${p}" was already moved or removed earlier in this plan`)
          if ((await statFn(p)) === null) return fail(`${n}: "${p}" does not exist`)
          gone.add(norm(p))
        }
        actions.push({ type: 'trash', paths })
        break
      }
      default:
        return fail(`${n}: unknown type "${String(a['type'])}". Allowed: mkdir, move, copy, rename, trash. Permanent delete does not exist.`)
    }
  }
  return { ok: true, plan: { title, actions } }
}
