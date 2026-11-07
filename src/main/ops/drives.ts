import { statfs } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import type { DriveInfo, DriveType } from '../../shared/types.ts'

/**
 * How drives are read (Windows):
 *  1. FAST PATH: probe C:\ .. Z:\ with statfs in parallel (1.5 s timeout each). A letter that
 *     answers is a mounted volume, and statfs also gives total/free space. No native modules.
 *  2. ENRICH: one PowerShell call (Win32_LogicalDisk) gives volume labels and drive types
 *     (fixed / USB / network / optical). It is slow (~0.3-1 s), so it runs in the background and
 *     is cached; the sidebar shows letters + space immediately and gains names on the next poll.
 *     It re-runs only when the set of drive letters changes (USB plugged in or removed).
 * A:\ and B:\ are skipped (legacy floppy letters).
 */

interface Meta {
  label: string
  type: DriveType
}

const TYPE_NAME: Record<DriveType, string> = {
  fixed: 'Local Disk',
  removable: 'USB Drive',
  network: 'Network Drive',
  optical: 'Optical Drive',
  unknown: 'Drive'
}

function driveType(code: unknown): DriveType {
  switch (code) {
    case 2:
      return 'removable'
    case 3:
      return 'fixed'
    case 4:
      return 'network'
    case 5:
      return 'optical'
    default:
      return 'unknown'
  }
}

/** Parses `Get-CimInstance Win32_LogicalDisk | ConvertTo-Json`. One disk gives an object, many give an array. */
export function parseDriveMeta(stdout: string): Map<string, Meta> {
  const out = new Map<string, Meta>()
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return out
  }
  const rows: unknown[] = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const id = typeof r['DeviceID'] === 'string' ? r['DeviceID'] : ''
    if (!/^[A-Za-z]:$/.test(id)) continue
    const label = typeof r['VolumeName'] === 'string' ? r['VolumeName'] : ''
    out.set(id.charAt(0).toUpperCase(), { label, type: driveType(r['DriveType']) })
  }
  return out
}

let metaCache = new Map<string, Meta>()
let metaKey = ''
let metaInFlight = false

function refreshMeta(letters: string[]): void {
  const key = letters.join('')
  if (key === metaKey || metaInFlight) return
  metaInFlight = true
  metaKey = key // set up front: if PowerShell fails we retry only when the drive set changes
  execFile(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,DriveType | ConvertTo-Json -Compress'
    ],
    { windowsHide: true, timeout: 8000 },
    (err, stdout) => {
      metaInFlight = false
      if (!err) metaCache = parseDriveMeta(String(stdout))
    }
  )
}

async function probeUsage(path: string): Promise<{ total: number; free: number } | null> {
  try {
    const s = await statfs(path)
    const total = s.blocks * s.bsize
    return total > 0 ? { total, free: s.bavail * s.bsize } : null
  } catch {
    return null // empty card reader, disconnected drive, no permission
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))])
}

export async function listDrives(): Promise<DriveInfo[]> {
  if (process.platform !== 'win32') {
    const usage = await probeUsage('/')
    return usage ? [{ path: '/', name: 'Root', type: 'fixed', ...usage }] : []
  }

  const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  const probed = await Promise.all(
    letters.map(async (letter) => {
      const path = `${letter}:\\`
      const usage = await withTimeout(probeUsage(path), 1500)
      return usage ? { letter, path, usage } : null
    })
  )
  const found = probed.filter((p): p is NonNullable<typeof p> => p !== null)
  refreshMeta(found.map((f) => f.letter))

  return found.map(({ letter, path, usage }) => {
    const meta = metaCache.get(letter)
    const type = meta?.type ?? 'unknown'
    const base = meta?.label || TYPE_NAME[type]
    return { path, name: `${base} (${letter}:)`, type, total: usage.total, free: usage.free }
  })
}
