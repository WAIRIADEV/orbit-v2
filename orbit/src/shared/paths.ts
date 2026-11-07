// Pure path helpers shared by main and renderer (the renderer cannot use node:path).
// Windows gotcha: "C:" means "current folder on drive C", NOT the drive root. The root is "C:\".

const DRIVE_NO_SLASH = /^[A-Za-z]:$/
const WIN_ROOT = /^[A-Za-z]:[\\/]?$/

/** "C:" -> "C:\" (anything else is returned unchanged). */
export function normalizeRoot(p: string): string {
  return DRIVE_NO_SLASH.test(p) ? p + '\\' : p
}

export function isRoot(p: string): boolean {
  return WIN_ROOT.test(p) || p === '/'
}

/** Parent folder. A root is its own parent. */
export function parentPath(input: string): string {
  const p = normalizeRoot(input)
  if (isRoot(p)) return p
  const trimmed = p.replace(/[\\/]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  if (idx < 0) return p
  const head = trimmed.slice(0, idx)
  if (head === '') return '/'
  return normalizeRoot(head)
}

/** Last path segment ("C:\Users\Tony" -> "Tony"). A root returns itself ("C:\"). */
export function baseName(input: string): string {
  const p = normalizeRoot(input)
  if (isRoot(p)) return p
  const parts = p.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

export interface Crumb {
  label: string
  path: string
}

/** Clickable path segments: "C:\Users\Tony" -> C: / Users / Tony, each with its full path. */
export function breadcrumbs(input: string): Crumb[] {
  const p = normalizeRoot(input)
  const parts = p.split(/[\\/]+/).filter(Boolean)
  const out: Crumb[] = []

  if (/^[A-Za-z]:/.test(p)) {
    const drive = parts.shift()
    if (!drive) return out
    let acc = drive + '\\'
    out.push({ label: drive, path: acc })
    for (const part of parts) {
      acc = acc + part
      out.push({ label: part, path: acc })
      acc += '\\'
    }
    // Only the drive root keeps a trailing backslash.
    return out.map((c, i) => (i === 0 ? c : { ...c, path: c.path.replace(/\\$/, '') }))
  }

  out.push({ label: '/', path: '/' })
  let acc = ''
  for (const part of parts) {
    acc += '/' + part
    out.push({ label: part, path: acc })
  }
  return out
}
