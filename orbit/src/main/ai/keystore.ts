import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** The slice of Electron's safeStorage that is used (so tests can fake it). */
export interface Safe {
  isEncryptionAvailable(): boolean
  encryptString(s: string): Buffer
  decryptString(b: Buffer): string
}

/**
 * Holds the Groq key. On disk it is only ever encrypted by the OS (DPAPI on Windows). If encryption is not
 * available the key lives in memory until ORBIT closes: it is never written to disk as plain text.
 */
export class KeyStore {
  private readonly file: string
  private readonly safe: Safe
  private cached: string | null | undefined

  constructor(file: string, safe: Safe) {
    this.file = file
    this.safe = safe
  }

  get canEncrypt(): boolean {
    try {
      return this.safe.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  async load(): Promise<void> {
    if (this.cached !== undefined) return
    this.cached = null
    if (!this.canEncrypt) return
    try {
      const raw = await readFile(this.file)
      this.cached = this.safe.decryptString(raw) || null
    } catch {
      this.cached = null // missing, or encrypted for another user/PC
    }
  }

  get(): string | null {
    return this.cached ?? null
  }

  async set(key: string): Promise<void> {
    const k = key.trim()
    this.cached = k
    if (!this.canEncrypt) return
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, this.safe.encryptString(k))
  }

  async clear(): Promise<void> {
    this.cached = null
    await rm(this.file, { force: true })
  }
}
