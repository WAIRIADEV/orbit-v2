import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { PdfBytes } from '../../shared/types.ts'

const ABSOLUTE = /^([a-z]:[\\/]|\\\\|\/)/i
export const MAX_PDF_BYTES = 300 * 1024 * 1024

/** Reads a PDF for the built-in reader. The renderer is sandboxed, so the size and path are checked here. */
export async function readPdfBytes(path: unknown, maxBytes = MAX_PDF_BYTES): Promise<PdfBytes> {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\0') || !ABSOLUTE.test(path)) return { ok: false, message: 'Invalid path' }
  if (!/\.pdf$/i.test(path)) return { ok: false, message: 'Not a PDF file' }
  try {
    const info = await stat(path)
    if (!info.isFile()) return { ok: false, message: 'Not a file' }
    if (info.size > maxBytes) return { ok: false, message: `Too large for the built-in reader (${Math.round(info.size / 1048576)} MB). Open it in your default app instead.` }
    const data = await readFile(path)
    return { ok: true, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { ok: false, message: 'File no longer exists' }
    if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY') return { ok: false, message: 'Windows would not let ORBIT read this file (in use or no permission)' }
    return { ok: false, message: (e as Error).message }
  }
}

/** Only character maps and standard font files of the PDF engine, one level deep, plain names. */
export function validPdfAsset(rel: unknown): rel is string {
  return typeof rel === 'string' && /^(cmaps|standard_fonts)\/[A-Za-z0-9._-]+$/.test(rel) && !rel.includes('..')
}

export async function readPdfAsset(packageRoot: string, rel: unknown): Promise<Uint8Array | null> {
  if (!validPdfAsset(rel)) return null
  try {
    const data = await readFile(join(packageRoot, rel))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  } catch {
    return null
  }
}
