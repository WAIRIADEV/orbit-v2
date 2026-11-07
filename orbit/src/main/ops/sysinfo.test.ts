import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coreLoads, SystemSampler, type CpuInfoLike, type CpuTimes } from './sysinfo.ts'

const t = (user: number, sys: number, idle: number): CpuTimes => ({ user, nice: 0, sys, idle, irq: 0 })

test('coreLoads: busy share of the change between snapshots', () => {
  const prev = [t(100, 100, 800), t(0, 0, 1000)]
  const cur = [t(150, 150, 900), t(0, 0, 1100)] // core0: +100 busy, +100 idle -> 50%; core1: all idle
  assert.deepEqual(coreLoads(prev, cur), [50, 0])
})

test('coreLoads: no elapsed time, counter reset, or missing previous core give 0', () => {
  assert.deepEqual(coreLoads([t(1, 1, 1)], [t(1, 1, 1)]), [0])
  assert.deepEqual(coreLoads([t(500, 500, 500)], [t(10, 10, 10)]), [0])
  assert.deepEqual(coreLoads([], [t(5, 5, 5)]), [0])
})

test('coreLoads: fully busy core is 100 and never exceeds it', () => {
  assert.deepEqual(coreLoads([t(0, 0, 0)], [t(100, 0, 0)]), [100])
})

function deps(snaps: CpuTimes[][], free = 2e9) {
  let i = 0
  return {
    cpus: (): CpuInfoLike[] => (snaps[Math.min(i++, snaps.length - 1)] ?? []).map((times) => ({ model: '  Intel(R)  Core(TM) i5 ', speed: 2500, times })),
    totalmem: () => 8e9,
    freemem: () => free,
    uptime: () => 1234.6
  }
}

test('sampler: first sample is 0, later samples are the change since the previous one', () => {
  const s = new SystemSampler(deps([[t(0, 0, 0), t(0, 0, 0)], [t(50, 0, 50), t(100, 0, 0)]]))
  const first = s.sample()
  assert.deepEqual(first.cores, [0, 0])
  assert.equal(first.cpu, 0)
  const second = s.sample()
  assert.deepEqual(second.cores, [50, 100])
  assert.equal(second.cpu, 75)
})

test('sampler: memory, clock, model and uptime', () => {
  const s = new SystemSampler(deps([[t(0, 0, 0)]], 3e9)).sample()
  assert.equal(s.memTotal, 8e9)
  assert.equal(s.memUsed, 5e9)
  assert.equal(s.baseMHz, 2500)
  assert.equal(s.cpuModel, 'Intel(R) Core(TM) i5')
  assert.equal(s.uptimeSec, 1235)
})

test('sampler: copes with no cpus and with free memory above total', () => {
  const none = new SystemSampler({ cpus: () => [], totalmem: () => 8e9, freemem: () => 9e9, uptime: () => 0 }).sample()
  assert.equal(none.cpu, 0)
  assert.equal(none.baseMHz, 0)
  assert.equal(none.memUsed, 0)
  assert.equal(none.cpuModel, 'Unknown processor')
})
