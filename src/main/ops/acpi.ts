/**
 * CPU/board temperature from the ACPI thermal zones, read through WMI (root\wmi MSAcpi_ThermalZoneTemperature).
 * Used only when the performance counter for temperature does not exist on this PC.
 *
 * Limits, which the page says out loud: Windows normally allows this query only to an administrator, and an ACPI
 * zone is whatever the motherboard vendor exposes (often the board or package, not a single CPU core).
 */

export type RunScript = (script: string) => Promise<string>

/** Constant script: nothing from outside is ever put inside it. */
export const ACPI_SCRIPT =
  "$ErrorActionPreference='Stop'; " +
  'Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature | ' +
  'ForEach-Object { [pscustomobject]@{ n = $_.InstanceName; t = $_.CurrentTemperature } } | ConvertTo-Json -Compress'

/** WMI reports tenths of a Kelvin. Returns the hottest sane zone in Celsius, or null if none is sane. */
export function parseAcpiTemps(stdout: string): number | null {
  const text = stdout.trim().replace(/^﻿/, '')
  if (!text) return null
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  const rows = Array.isArray(data) ? data : [data] // one zone: PowerShell 5.1 emits a bare object
  const temps: number[] = []
  for (const r of rows) {
    const t = (r as { t?: unknown } | null)?.t
    if (typeof t !== 'number') continue
    const c = t / 10 - 273.15
    if (c > 0 && c < 130) temps.push(c)
  }
  return temps.length > 0 ? Math.round(Math.max(...temps) * 10) / 10 : null
}

/** A short, human reason for a failed query. */
export function explainAcpiError(message: string): string {
  if (/access.{0,10}denied|0x80041003|not authorized|unauthorized/i.test(message)) return 'Needs administrator rights (Windows blocks the ACPI temperature for normal users)'
  if (/invalid (class|namespace)|not supported|0x8004100[2-9a-f]|provider/i.test(message)) return 'This PC does not expose an ACPI temperature'
  const first = message.trim().split(/\r?\n/)[0] ?? ''
  return first ? first.slice(0, 160) : 'This PC does not expose an ACPI temperature'
}

export interface AcpiState {
  status: 'starting' | 'ok' | 'unavailable'
  tempC: number | null
  reason: string | null
}

/**
 * Polls the ACPI temperature every few seconds while someone is looking (PowerShell start-up is slow, so this is
 * deliberately not once a second). One query at a time; stops cleanly.
 */
export class AcpiThermal {
  private readonly run: RunScript
  private readonly everyMs: number
  private timer: ReturnType<typeof setInterval> | null = null
  private busy = false
  private state: AcpiState = { status: 'starting', tempC: null, reason: null }

  constructor(run: RunScript, everyMs = 5000) {
    this.run = run
    this.everyMs = everyMs
  }

  get current(): AcpiState {
    return this.state
  }

  start(): void {
    if (this.timer) return
    void this.poll()
    this.timer = setInterval(() => void this.poll(), this.everyMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.state = { status: 'starting', tempC: null, reason: null }
  }

  async poll(): Promise<void> {
    if (this.busy) return // never stack queries
    this.busy = true
    try {
      const out = await this.run(ACPI_SCRIPT)
      const c = parseAcpiTemps(out)
      this.state =
        c !== null
          ? { status: 'ok', tempC: c, reason: null }
          : { status: 'unavailable', tempC: null, reason: 'This PC reports no usable ACPI temperature' }
    } catch (e) {
      this.state = { status: 'unavailable', tempC: null, reason: explainAcpiError((e as Error).message) }
    } finally {
      this.busy = false
    }
  }
}

/** Real runner: Windows PowerShell with the script passed as -EncodedCommand (no quoting problems, no stdin quirks). */
export async function powershellRun(script: string): Promise<string> {
  const { spawn } = await import('node:child_process')
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('PowerShell took too long'))
    }, 20_000)
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d))
    child.stderr.setEncoding('utf8').on('data', (d: string) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(err.trim() || `PowerShell exited with code ${code}`))
    })
  })
}
