// URLs for the custom "orbit-media" protocol that lets the renderer show local images, video and audio
// without turning off web security. Format: orbit-media://file/<url-encoded absolute path>

export const MEDIA_SCHEME = 'orbit-media'

export function mediaUrl(path: string): string {
  return `${MEDIA_SCHEME}://file/${encodeURIComponent(path)}`
}

const ABSOLUTE = /^([a-z]:[\\/]|\/)/i

/** Thumbnail URL. `version` (the file's mtime) makes the browser cache follow edits. */
export function thumbUrl(path: string, version: number): string {
  return `${MEDIA_SCHEME}://thumb/${encodeURIComponent(path)}?v=${Math.trunc(version)}`
}

/** Decodes a media URL back to a local path. Returns null for anything that is not a well-formed absolute path. */
export function pathFromMediaUrl(url: string, host: 'file' | 'thumb' = 'file'): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== `${MEDIA_SCHEME}:` || u.hostname !== host) return null
    const path = decodeURIComponent(u.pathname.slice(1))
    if (!ABSOLUTE.test(path) || path.includes('\0')) return null
    return path
  } catch {
    return null
  }
}
