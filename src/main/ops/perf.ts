import type { PerfPart, PerfSample } from '../../shared/types.ts'

/** The slice of Electron's ProcessMetric we use (kept structural so it can be tested without Electron). */
export interface ProcMetric {
  type: string
  cpu: { percentCPUUsage: number }
  memory: { workingSetSize: number; privateBytes?: number }
}

const NAMES: Record<string, string> = {
  Browser: 'Main',
  Tab: 'Interface',
  GPU: 'Graphics',
  Utility: 'Helper'
}

const round1 = (n: number): number => Math.round(n * 10) / 10

/**
 * Turns Electron's per-process metrics into one number for the status bar.
 * Electron reports CPU as % of ONE core, so it is divided by the core count to get % of the whole machine
 * (what Task Manager shows). Memory prefers private bytes (what the app really owns) over working set,
 * which double-counts shared pages. Both memory fields are in KB.
 */
export function summarizeMetrics(metrics: ProcMetric[], cores: number): PerfSample {
  const n = Math.max(1, cores)
  const byName = new Map<string, PerfPart>()
  let cpu = 0
  let kb = 0
  for (const m of metrics) {
    const c = Math.max(0, m.cpu.percentCPUUsage) / n
    const k = Math.max(0, m.memory.privateBytes ?? m.memory.workingSetSize)
    cpu += c
    kb += k
    const name = NAMES[m.type] ?? m.type
    const part = byName.get(name) ?? { name, count: 0, cpu: 0, memMB: 0 }
    part.count++
    part.cpu += c
    part.memMB += k / 1024
    byName.set(name, part)
  }
  const parts = [...byName.values()]
    .map((p) => ({ ...p, cpu: round1(p.cpu), memMB: Math.round(p.memMB) }))
    .sort((a, b) => b.memMB - a.memMB)
  return { cpu: round1(Math.min(100, cpu)), memMB: Math.round(kb / 1024), processes: metrics.length, parts }
}
