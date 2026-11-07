import type { SysSample } from '../../shared/types.ts'

export interface CpuTimes {
  user: number
  nice: number
  sys: number
  idle: number
  irq: number
}

export interface CpuInfoLike {
  model: string
  speed: number
  times: CpuTimes
}

const total = (t: CpuTimes): number => t.user + t.nice + t.sys + t.idle + t.irq

/** Busy % (0-100) per core between two snapshots of os.cpus().times. Counter resets and odd input give 0. */
export function coreLoads(prev: CpuTimes[], cur: CpuTimes[]): number[] {
  return cur.map((c, i) => {
    const p = prev[i]
    if (!p) return 0
    const dTotal = total(c) - total(p)
    const dIdle = c.idle - p.idle
    if (!(dTotal > 0) || dIdle < 0) return 0
    return Math.min(100, Math.max(0, Math.round(((dTotal - dIdle) / dTotal) * 1000) / 10))
  })
}

export interface SamplerDeps {
  cpus: () => CpuInfoLike[]
  totalmem: () => number
  freemem: () => number
  uptime: () => number
}

/**
 * Takes system samples. CPU load needs two snapshots, so it is the change since the previous call:
 * the first call reports 0, and a single window that polls once a second gets a 1-second average.
 */
export class SystemSampler {
  private readonly deps: SamplerDeps
  private prev: CpuTimes[] | null = null

  constructor(deps: SamplerDeps) {
    this.deps = deps
  }

  sample(): SysSample {
    const cpus = this.deps.cpus()
    const times = cpus.map((c) => ({ ...c.times }))
    const cores = this.prev ? coreLoads(this.prev, times) : times.map(() => 0)
    this.prev = times
    const cpu = cores.length > 0 ? Math.round((cores.reduce((a, b) => a + b, 0) / cores.length) * 10) / 10 : 0
    const speeds = cpus.map((c) => c.speed).filter((s) => s > 0)
    const memTotal = this.deps.totalmem()
    return {
      cpuModel: (cpus[0]?.model ?? 'Unknown processor').replace(/\s+/g, ' ').trim(),
      cores,
      cpu,
      baseMHz: speeds.length > 0 ? Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length) : 0,
      memTotal,
      memUsed: Math.max(0, Math.min(memTotal, memTotal - this.deps.freemem())),
      uptimeSec: Math.round(this.deps.uptime())
    }
  }
}
