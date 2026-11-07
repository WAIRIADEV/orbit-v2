import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeMetrics, type ProcMetric } from './perf.ts'

const proc = (type: string, cpu: number, privateKb: number | undefined, wsKb = 0): ProcMetric => ({
  type,
  cpu: { percentCPUUsage: cpu },
  memory: privateKb === undefined ? { workingSetSize: wsKb } : { workingSetSize: wsKb, privateBytes: privateKb }
})

test('sums processes, converts CPU to % of the whole machine and KB to MB', () => {
  const s = summarizeMetrics([proc('Browser', 40, 100 * 1024), proc('Tab', 80, 200 * 1024), proc('GPU', 0, 50 * 1024)], 8)
  assert.equal(s.cpu, 15) // (40 + 80) / 8
  assert.equal(s.memMB, 350)
  assert.equal(s.processes, 3)
})

test('prefers private bytes, falls back to working set', () => {
  assert.equal(summarizeMetrics([proc('Tab', 0, 100 * 1024, 900 * 1024)], 4).memMB, 100)
  assert.equal(summarizeMetrics([proc('Tab', 0, undefined, 300 * 1024)], 4).memMB, 300)
})

test('groups by friendly name, biggest memory first', () => {
  const s = summarizeMetrics([proc('Tab', 8, 300 * 1024), proc('Tab', 8, 100 * 1024), proc('Browser', 0, 50 * 1024)], 4)
  assert.deepEqual(s.parts.map((p) => [p.name, p.count, p.memMB]), [['Interface', 2, 400], ['Main', 1, 50]])
  assert.equal(s.parts[0]?.cpu, 4)
})

test('is safe with no processes, zero cores, negative or runaway values', () => {
  assert.deepEqual(summarizeMetrics([], 0), { cpu: 0, memMB: 0, processes: 0, parts: [] })
  assert.equal(summarizeMetrics([proc('Tab', -5, -10)], 0).cpu, 0)
  assert.equal(summarizeMetrics([proc('Tab', 900, 1)], 1).cpu, 100)
})
