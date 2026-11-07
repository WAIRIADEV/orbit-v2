import { stat } from 'node:fs/promises'

const ABSOLUTE = /^([a-z]:[\\/]|\\\\|\/)/i

/**
 * Validates a path before it is handed to the OS to open. Returns an error message, or null when fine.
 * The renderer is sandboxed, so the main process refuses anything that is not a plain absolute path to an existing entry.
 */
export async function checkOpenable(path: unknown): Promise<string | null> {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\0')) return 'Invalid path'
  if (!ABSOLUTE.test(path)) return 'Path must be absolute'
  try {
    await stat(path)
  } catch {
    return 'File no longer exists'
  }
  return null
}
