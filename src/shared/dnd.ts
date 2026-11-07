import { parentPath } from './paths.ts'

// Windows paths compare case-insensitively and accept either slash; POSIX paths are exact.
const WIN_DRIVE = /^[a-z]:/i

function norm(p: string): string {
  let s = p.replace(/\\/g, '/').replace(/\/+$/, '')
  if (s === '') s = '/'
  return WIN_DRIVE.test(s) ? s.toLowerCase() : s
}

export function samePath(a: string, b: string): boolean {
  return norm(a) === norm(b)
}

/** True when `child` is strictly below `parent`. */
export function isInside(child: string, parent: string): boolean {
  const c = norm(child)
  const p = norm(parent)
  if (c === p) return false
  return c.startsWith(p === '/' ? '/' : p + '/')
}

export type DropVerdict = 'ok' | 'same-folder' | 'into-self' | 'nothing'

/**
 * Can these items be dropped into targetDir?
 *  - into-self:   a folder onto itself or onto one of its own subfolders (never allowed)
 *  - same-folder: a MOVE back into the folder they already live in (pointless, so refused)
 *  - copying into the same folder is allowed: it makes "name (1)" duplicates.
 */
export function dropVerdict(sources: string[], targetDir: string, copy: boolean): DropVerdict {
  if (sources.length === 0) return 'nothing'
  for (const s of sources) {
    if (samePath(s, targetDir) || isInside(targetDir, s)) return 'into-self'
  }
  if (!copy && sources.every((s) => samePath(parentPath(s), targetDir))) return 'same-folder'
  return 'ok'
}
