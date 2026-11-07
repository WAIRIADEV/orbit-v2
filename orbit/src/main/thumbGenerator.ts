import { nativeImage } from 'electron'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'

const DECODABLE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico'])
const MAX_FALLBACK_BYTES = 40 * 1024 * 1024 // decoding in the main process is synchronous: skip huge images

/**
 * Windows and macOS: the OS shell makes the thumbnail, so images, videos, PDFs and Office files look
 * the same as in Explorer. Elsewhere (and when the shell has no handler) we decode images ourselves.
 */
export async function makeThumbnail(path: string, px: number): Promise<Buffer | null> {
  try {
    if (typeof nativeImage.createThumbnailFromPath === 'function') {
      const img = await nativeImage.createThumbnailFromPath(path, { width: px, height: px })
      if (!img.isEmpty()) return img.toPNG()
    }
  } catch {
    /* no shell thumbnail for this file: try the fallback */
  }

  if (!DECODABLE.has(extname(path).toLowerCase())) return null
  try {
    if ((await stat(path)).size > MAX_FALLBACK_BYTES) return null
    const img = nativeImage.createFromPath(path)
    if (img.isEmpty()) return null
    const { width, height } = img.getSize()
    const scale = Math.min(1, px / Math.max(width, height))
    const out = scale < 1 ? img.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' }) : img
    return out.toPNG()
  } catch {
    return null
  }
}
