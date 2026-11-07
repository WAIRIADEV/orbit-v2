import { open } from 'node:fs/promises'
import type { TextPreview } from '../../shared/types.ts'

export const PREVIEW_BYTES = 64 * 1024
const SNIFF_BYTES = 4096

/**
 * Reads the start of a file for Quick Look. Never loads more than PREVIEW_BYTES, so a 4 GB log file
 * previews instantly. A NUL byte in the first few KB means "binary": we show file info instead of garbage.
 */
export async function readTextPreview(path: string, maxBytes: number = PREVIEW_BYTES): Promise<TextPreview> {
  let handle
  try {
    handle = await open(path, 'r')
    const { size } = await handle.stat()
    const buf = Buffer.alloc(Math.min(size, maxBytes))
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
    const bytes = buf.subarray(0, bytesRead)

    if (bytes.subarray(0, SNIFF_BYTES).includes(0)) return { kind: 'binary' }

    const truncated = size > bytesRead
    let text = new TextDecoder('utf-8').decode(bytes)
    // Cutting at a byte limit can split a multi-byte character: drop the replacement char it leaves behind.
    if (truncated) text = text.replace(/�$/, '')
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // UTF-8 BOM
    return { kind: 'text', text, truncated }
  } catch (e) {
    return { kind: 'error', message: (e as Error).message }
  } finally {
    await handle?.close().catch(() => {})
  }
}
