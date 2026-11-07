import type { SensorReading } from '../../shared/types.ts'
import type { AcpiThermal } from './acpi.ts'

/**
 * Live hardware readings from Windows performance counters, through the built-in `typeperf` tool
 * (no PowerShell, no drivers, nothing to install). These are the same counters Task Manager uses.
 *
 * Counters are split into groups with one typeperf process each, because a single missing counter makes
 * typeperf refuse the whole command: a PC without GPU counters must not lose its CPU clock.
 * Anything a PC doesn't provide stays null and the page shows N/A.
 */

export type GroupId = 'basic' | 'thermal' | 'gpu' | 'vram'

export const GROUPS: Record<GroupId, string[]> = {
  basic: [
    '\\Processor Information(_Total)\\% Processor Performance',
    '\\Processor Information(_Total)\\Processor Frequency',
    '\\PhysicalDisk(_Total)\\% Disk Time',
    '\\PhysicalDisk(_Total)\\Disk Read Bytes/sec',
    '\\PhysicalDisk(_Total)\\Disk Write Bytes/sec',
    '\\Network Interface(*)\\Bytes Received/sec',
    '\\Network Interface(*)\\Bytes Sent/sec'
  ],
  thermal: ['\\Thermal Zone Information(*)\\Temperature'],
  gpu: ['\\GPU Engine(*)\\Utilization Percentage'],
  vram: ['\\GPU Adapter Memory(*)\\Dedicated Usage', '\\GPU Adapter Memory(*)\\Shared Usage']
}

export interface Column {
  object: string
  instance: string
  counter: string
  value: number | null
}

/** Splits one CSV line of quoted fields ("a","b,c") into its values. */
export function splitCsv(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = false
      } else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

const PATH = /^\\\\[^\\]+\\([^\\(]+)(?:\(([^)]*)\))?\\(.+)$/

/** `\\HOST\GPU Engine(pid_1_eng_0_engtype_3D)\Utilization Percentage` -> its parts. */
export function parsePath(path: string): { object: string; instance: string; counter: string } | null {
  const m = PATH.exec(path.trim())
  return m ? { object: m[1] ?? '', instance: m[2] ?? '', counter: m[3] ?? '' } : null
}

/** typeperf prints a blank/space for a counter that has no value yet. */
function toNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const t = raw.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * Turns typeperf's streamed CSV into rows. The first line is a header naming every counter; every later
 * line is one sample. Chunks can split lines anywhere, so input is buffered until a newline.
 */
export class CsvStream {
  private buf = ''
  private header: Array<{ object: string; instance: string; counter: string }> | null = null
  /** Lines that were not CSV (typeperf prints errors as plain text), kept for diagnosis. */
  readonly noise: string[] = []
  private readonly onRow: (cols: Column[]) => void
  private skip: number

  /** `skipRows`: leading samples to ignore. Rate counters have nothing to compare against on the first sample. */
  constructor(onRow: (cols: Column[]) => void, skipRows = 0) {
    this.onRow = onRow
    this.skip = skipRows
  }

  /** Text from typeperf's error stream (or any non-CSV output), kept so an N/A can say why. */
  addNoise(text: string): void {
    for (const raw of text.split(/\r?\n/)) {
      const t = raw.trim()
      if (t === '' || /^(exiting, please wait|the command completed successfully)/i.test(t)) continue
      if (this.noise.length < 20) this.noise.push(t)
    }
  }

  feed(chunk: string): void {
    this.buf += chunk
    let nl: number
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).replace(/\r$/, '')
      this.buf = this.buf.slice(nl + 1)
      this.line(line)
    }
  }

  private line(line: string): void {
    if (line.trim() === '') return
    if (!line.startsWith('"')) {
      this.addNoise(line)
      return
    }
    const f = splitCsv(line)
    if (!this.header) {
      // First field is "(PDH-CSV 4.0)"; the rest are counter paths.
      this.header = f.slice(1).map((p) => parsePath(p) ?? { object: '', instance: '', counter: p })
      return
    }
    if (this.skip > 0) {
      this.skip--
      return
    }
    const h = this.header
    this.onRow(h.map((c, i) => ({ ...c, value: toNumber(f[i + 1]) })))
  }
}

// ---------- reductions (pure) ----------

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)

/** No real CPU idles below this share of its nominal speed. */
const MIN_PLAUSIBLE_PERF = 20

function values(cols: Column[] | undefined, counter: string): number[] {
  return (cols ?? []).filter((c) => c.counter === counter && c.value !== null).map((c) => c.value as number)
}

export type Rows = Partial<Record<GroupId, Column[]>>

export const EMPTY_READING: SensorReading = {
  cpuMHz: null,
  tempC: null,
  gpuPct: null,
  vramMB: null,
  diskBusyPct: null,
  diskReadBps: null,
  diskWriteBps: null,
  netRxBps: null,
  netTxBps: null,
  cpuNominalMHz: null,
  cpuPerfPct: null,
  vramShared: false,
  tempSource: null,
  status: { basic: 'starting', thermal: 'starting', gpu: 'starting', vram: 'starting' }
}

/** Combines the latest row of every group into one reading. */
export function buildReading(rows: Rows, status: SensorReading['status']): SensorReading {
  const r: SensorReading = { ...EMPTY_READING, status }

  const b = rows.basic
  const freq = values(b, 'Processor Frequency')[0]
  const perf = values(b, '% Processor Performance')[0]
  if (freq !== undefined && freq > 0) {
    r.cpuNominalMHz = Math.round(freq)
    r.cpuPerfPct = perf !== undefined ? Math.round(perf) : null
    // Live clock = nominal frequency x current performance %. Some CPUs report a performance figure that makes
    // no physical sense (far below any real idle speed); that is rejected so it is never shown as "live".
    if (perf !== undefined && perf >= MIN_PLAUSIBLE_PERF && perf <= 400) r.cpuMHz = Math.round((freq * perf) / 100)
  }
  const disk = values(b, '% Disk Time')[0]
  if (disk !== undefined) r.diskBusyPct = Math.min(100, Math.max(0, Math.round(disk))) // the counter can exceed 100
  const rd = values(b, 'Disk Read Bytes/sec')[0]
  const wr = values(b, 'Disk Write Bytes/sec')[0]
  if (rd !== undefined) r.diskReadBps = Math.max(0, Math.round(rd))
  if (wr !== undefined) r.diskWriteBps = Math.max(0, Math.round(wr))
  const rx = values(b, 'Bytes Received/sec')
  const tx = values(b, 'Bytes Sent/sec')
  if (rx.length > 0) r.netRxBps = Math.round(sum(rx))
  if (tx.length > 0) r.netTxBps = Math.round(sum(tx))

  // Thermal zones report Kelvin. The hottest sane zone wins; absurd values (sensor not wired up) are dropped.
  const temps = values(rows.thermal, 'Temperature')
    .map((k) => k - 273.15)
    .filter((c) => c > 0 && c < 130)
  if (temps.length > 0) r.tempC = Math.round(Math.max(...temps) * 10) / 10

  // GPU load: sum per engine type across all processes, then take the busiest engine (what Task Manager shows).
  const perEngine = new Map<string, number>()
  for (const c of rows.gpu ?? []) {
    if (c.counter !== 'Utilization Percentage' || c.value === null) continue
    const type = /engtype_([A-Za-z0-9_ ]+)$/.exec(c.instance)?.[1] ?? 'other'
    perEngine.set(type, (perEngine.get(type) ?? 0) + c.value)
  }
  if (perEngine.size > 0) r.gpuPct = Math.min(100, Math.round(Math.max(...perEngine.values()) * 10) / 10)

  // Integrated GPUs have (almost) no dedicated memory and use shared system memory: show that instead of "0 MB".
  const MB = 1024 * 1024
  const dedicated = sum(values(rows.vram, 'Dedicated Usage')) / MB
  const shared = sum(values(rows.vram, 'Shared Usage')) / MB
  const haveVram = values(rows.vram, 'Dedicated Usage').length > 0 || values(rows.vram, 'Shared Usage').length > 0
  if (haveVram) {
    r.vramShared = dedicated < 16 && shared > 0
    r.vramMB = Math.round(r.vramShared ? shared : dedicated)
  }
  return r
}

// ---------- process management ----------

export interface ChildLike {
  stdout: { on(event: 'data', cb: (d: Buffer | string) => void): unknown } | null
  stderr?: { on(event: 'data', cb: (d: Buffer | string) => void): unknown } | null
  on(event: 'close' | 'error', cb: () => void): unknown
  kill(): unknown
}
export type SpawnFn = (cmd: string, args: string[]) => ChildLike

export interface HubOptions {
  spawn: SpawnFn
  supported: boolean
  /** Stops everything when nobody has asked for a reading for this long (renderer gone or page closed). */
  idleMs?: number
  now?: () => number
  /** Fallback temperature source, used only if the performance counter for temperature does not exist. */
  acpi?: AcpiThermal
}

interface Group {
  id: GroupId
  child: ChildLike | null
  stream: CsvStream
  status: 'starting' | 'ok' | 'unavailable'
  row: Column[] | null
  restarts: number
}

/**
 * Runs the typeperf processes while the System Monitor is open. Started lazily by the first read(),
 * stopped by stop() or after an idle period. typeperf is asked for a bounded number of samples
 * (it is restarted when it ends), so even a crash can't leave one running forever.
 */
export class SensorHub {
  private readonly o: Required<Omit<HubOptions, 'spawn' | 'supported' | 'acpi'>> & Pick<HubOptions, 'spawn' | 'supported' | 'acpi'>
  private groups = new Map<GroupId, Group>()
  private running = false
  private lastRead = 0
  private idleTimer: ReturnType<typeof setInterval> | null = null

  constructor(opts: HubOptions) {
    this.o = { idleMs: 10_000, now: Date.now, ...opts }
  }

  read(): SensorReading {
    this.lastRead = this.o.now()
    if (!this.o.supported) {
      const status = { basic: 'unavailable', thermal: 'unavailable', gpu: 'unavailable', vram: 'unavailable' } as const
      return { ...EMPTY_READING, status }
    }
    if (!this.running) this.start()
    const rows: Rows = {}
    const status = { ...EMPTY_READING.status }
    for (const [id, g] of this.groups) {
      status[id] = g.status
      if (g.row) rows[id] = g.row
    }
    const reading = buildReading(rows, status)
    if (reading.tempC !== null) reading.tempSource = 'counter'

    // No temperature counter on this PC: fall back to the ACPI thermal zone.
    const acpi = this.o.acpi
    if (acpi && status.thermal === 'unavailable') {
      acpi.start()
      const a = acpi.current
      if (a.status === 'ok' && a.tempC !== null) {
        reading.tempC = a.tempC
        reading.tempSource = 'acpi'
        reading.status = { ...status, thermal: 'ok' }
      } else if (a.status === 'unavailable') {
        reading.notes = { thermal: [a.reason ?? 'Not provided by this PC'] }
      } else {
        reading.status = { ...status, thermal: 'starting' }
      }
    }
    return reading
  }

  /** Why a group is unavailable (typeperf's own message), for the page's diagnostics. */
  notes(): Record<string, string[]> {
    const out: Record<string, string[]> = {}
    for (const [id, g] of this.groups) if (g.stream.noise.length > 0) out[id] = [...g.stream.noise]
    return out
  }

  private start(): void {
    this.running = true
    for (const id of Object.keys(GROUPS) as GroupId[]) this.launch(id)
    this.idleTimer = setInterval(() => {
      if (this.o.now() - this.lastRead > this.o.idleMs) this.stop()
    }, 2000)
    this.idleTimer.unref?.()
  }

  private launch(id: GroupId, previous?: Group): void {
    const g: Group = previous ?? { id, child: null, status: 'starting', row: null, restarts: 0, stream: null as unknown as CsvStream }
    g.stream = new CsvStream((cols) => {
      g.row = cols
      g.status = 'ok'
    }, 1)
    this.groups.set(id, g)
    let child: ChildLike
    try {
      child = this.o.spawn('typeperf', [...GROUPS[id], '-si', '1', '-sc', '120'])
    } catch {
      g.status = 'unavailable'
      return
    }
    g.child = child
    child.stdout?.on('data', (d) => g.stream.feed(typeof d === 'string' ? d : d.toString('utf8')))
    // typeperf reports its errors ("No valid counters", access problems) on stderr.
    child.stderr?.on('data', (d) => g.stream.addNoise(typeof d === 'string' ? d : d.toString('utf8')))
    const ended = (): void => {
      if (g.child !== child) return
      g.child = null
      // Ended after producing data: it just hit its sample limit, so start the next batch.
      if (this.running && g.status === 'ok' && g.restarts < 10_000) {
        g.restarts++
        this.launch(id, g)
      } else if (g.status !== 'ok') g.status = 'unavailable' // never produced a row: counter missing on this PC
    }
    child.on('close', ended)
    child.on('error', ended)
  }

  stop(): void {
    this.running = false
    if (this.idleTimer) clearInterval(this.idleTimer)
    this.idleTimer = null
    for (const g of this.groups.values()) {
      const c = g.child
      g.child = null
      try {
        c?.kill()
      } catch {
        /* already gone */
      }
    }
    this.groups.clear()
    this.o.acpi?.stop()
  }
}
