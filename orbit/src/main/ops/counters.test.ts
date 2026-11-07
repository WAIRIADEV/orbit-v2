import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { buildReading, CsvStream, EMPTY_READING, parsePath, SensorHub, splitCsv, type ChildLike, type Column } from './counters.ts'

const row = (...pairs: Array<[string, string, string, number | null]>): Column[] =>
  pairs.map(([object, instance, counter, value]) => ({ object, instance, counter, value }))

test('splitCsv handles quoted fields, commas and escaped quotes', () => {
  assert.deepEqual(splitCsv('"a","b,c","d""e"'), ['a', 'b,c', 'd"e'])
  assert.deepEqual(splitCsv('"x",""'), ['x', ''])
})

test('parsePath splits object, instance and counter', () => {
  assert.deepEqual(parsePath('\\\\PC\\GPU Engine(pid_12_luid_0x0_0x1_phys_0_eng_0_engtype_3D)\\Utilization Percentage'), {
    object: 'GPU Engine',
    instance: 'pid_12_luid_0x0_0x1_phys_0_eng_0_engtype_3D',
    counter: 'Utilization Percentage'
  })
  assert.deepEqual(parsePath('\\\\PC\\Memory\\Available MBytes'), { object: 'Memory', instance: '', counter: 'Available MBytes' })
  assert.equal(parsePath('garbage'), null)
})

const HEADER = '"(PDH-CSV 4.0)","\\\\PC\\Processor Information(_Total)\\% Processor Performance","\\\\PC\\Processor Information(_Total)\\Processor Frequency"'

test('CsvStream: header then samples, tolerant of chunks split mid-line and CRLF', () => {
  const rows: Column[][] = []
  const s = new CsvStream((r) => rows.push(r))
  const text = `${HEADER}\r\n"11/05/2026 22:30:01.123","44.5","3200"\r\n"11/05/2026 22:30:02.123"," ","3200"\r\n`
  for (let i = 0; i < text.length; i += 7) s.feed(text.slice(i, i + 7)) // awkward chunk size on purpose
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0]?.map((c) => [c.counter, c.value]), [['% Processor Performance', 44.5], ['Processor Frequency', 3200]])
  assert.equal(rows[1]?.[0]?.value, null) // blank value = no sample yet
})

test('CsvStream: typeperf error text is kept as noise, never parsed as data', () => {
  let n = 0
  const s = new CsvStream(() => n++)
  s.feed('Error:\r\nNo valid counters.\r\n')
  assert.equal(n, 0)
  assert.deepEqual(s.noise, ['Error:', 'No valid counters.'])
})

test('CsvStream: skips warm-up samples, and keeps stderr text but not the boilerplate', () => {
  const rows: Column[][] = []
  const s = new CsvStream((r) => rows.push(r), 1)
  s.feed(`${HEADER}\r\n"t","1","3200"\r\n"t","50","3200"\r\n`)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.[0]?.value, 50) // the first sample was dropped
  s.addNoise('Error:\r\nNo valid counters.\r\nExiting, please wait...\r\nThe command completed successfully.\r\n')
  assert.deepEqual(s.noise, ['Error:', 'No valid counters.'])
})

test('buildReading: live clock = frequency x performance %', () => {
  const r = buildReading({ basic: row(['Processor Information', '_Total', '% Processor Performance', 50], ['Processor Information', '_Total', 'Processor Frequency', 3200]) }, EMPTY_READING.status)
  assert.equal(r.cpuMHz, 1600)
  assert.equal(r.cpuNominalMHz, 3200)
  const boost = buildReading({ basic: row(['Processor Information', '_Total', '% Processor Performance', 103], ['Processor Information', '_Total', 'Processor Frequency', 3200]) }, EMPTY_READING.status)
  assert.equal(boost.cpuMHz, 3296)
})

test('buildReading: an implausible performance figure is not shown as a live clock (the 410 MHz case)', () => {
  const r = buildReading({ basic: row(['Processor Information', '_Total', '% Processor Performance', 12.8], ['Processor Information', '_Total', 'Processor Frequency', 3200]) }, EMPTY_READING.status)
  assert.equal(r.cpuMHz, null)
  assert.equal(r.cpuNominalMHz, 3200)
  assert.equal(r.cpuPerfPct, 13)
  const noPerf = buildReading({ basic: row(['Processor Information', '_Total', 'Processor Frequency', 3200]) }, EMPTY_READING.status)
  assert.equal(noPerf.cpuMHz, null)
  assert.equal(noPerf.cpuNominalMHz, 3200)
})

test('buildReading: disk clamps, network sums across adapters', () => {
  const r = buildReading(
    {
      basic: row(
        ['PhysicalDisk', '_Total', '% Disk Time', 187.2],
        ['PhysicalDisk', '_Total', 'Disk Read Bytes/sec', 1000],
        ['PhysicalDisk', '_Total', 'Disk Write Bytes/sec', 2000],
        ['Network Interface', 'Ethernet', 'Bytes Received/sec', 500],
        ['Network Interface', 'Wi-Fi', 'Bytes Received/sec', 250],
        ['Network Interface', 'Ethernet', 'Bytes Sent/sec', 10]
      )
    },
    EMPTY_READING.status
  )
  assert.equal(r.diskBusyPct, 100)
  assert.equal(r.diskReadBps, 1000)
  assert.equal(r.diskWriteBps, 2000)
  assert.equal(r.netRxBps, 750)
  assert.equal(r.netTxBps, 10)
})

test('buildReading: temperature converts Kelvin, takes the hottest sane zone, drops junk', () => {
  const r = buildReading({ thermal: row(['Thermal Zone Information', 'TZ00', 'Temperature', 320.15], ['Thermal Zone Information', 'TZ01', 'Temperature', 300], ['Thermal Zone Information', 'TZ02', 'Temperature', 0]) }, EMPTY_READING.status)
  assert.equal(r.tempC, 47)
  const junk = buildReading({ thermal: row(['Thermal Zone Information', 'TZ00', 'Temperature', 0], ['Thermal Zone Information', 'TZ01', 'Temperature', 9999]) }, EMPTY_READING.status)
  assert.equal(junk.tempC, null)
})

test('buildReading: GPU load is the busiest engine type summed over processes; VRAM sums adapters', () => {
  const gpu = row(
    ['GPU Engine', 'pid_1_luid_0x0_0x1_phys_0_eng_0_engtype_3D', 'Utilization Percentage', 20],
    ['GPU Engine', 'pid_2_luid_0x0_0x1_phys_0_eng_0_engtype_3D', 'Utilization Percentage', 15],
    ['GPU Engine', 'pid_2_luid_0x0_0x1_phys_0_eng_1_engtype_VideoDecode', 'Utilization Percentage', 30],
    ['GPU Engine', 'pid_3_luid_0x0_0x1_phys_0_eng_2_engtype_Copy', 'Utilization Percentage', null]
  )
  const r = buildReading({ gpu, vram: row(['GPU Adapter Memory', 'luid_a', 'Dedicated Usage', 300 * 1024 * 1024]) }, EMPTY_READING.status)
  assert.equal(r.gpuPct, 35) // 3D: 20+15 beats VideoDecode: 30
  assert.equal(r.vramMB, 300)
  assert.equal(r.vramShared, false)
  assert.equal(buildReading({ gpu: row(['GPU Engine', 'pid_1_engtype_3D', 'Utilization Percentage', 250]) }, EMPTY_READING.status).gpuPct, 100)
})

test('buildReading: an integrated GPU (no dedicated memory) reports shared memory instead of 0 MB', () => {
  const r = buildReading({ vram: row(['GPU Adapter Memory', 'luid_a', 'Dedicated Usage', 0], ['GPU Adapter Memory', 'luid_a', 'Shared Usage', 410 * 1024 * 1024]) }, EMPTY_READING.status)
  assert.equal(r.vramMB, 410)
  assert.equal(r.vramShared, true)
  const none = buildReading({ vram: row(['GPU Adapter Memory', 'luid_a', 'Dedicated Usage', 0], ['GPU Adapter Memory', 'luid_a', 'Shared Usage', 0]) }, EMPTY_READING.status)
  assert.equal(none.vramMB, 0) // genuinely nothing in use
})

test('buildReading: nothing available stays null', () => {
  const r = buildReading({}, EMPTY_READING.status)
  assert.equal(r.cpuMHz, null)
  assert.equal(r.tempC, null)
  assert.equal(r.gpuPct, null)
  assert.equal(r.vramMB, null)
  assert.equal(r.netRxBps, null)
})

// ---------- hub ----------

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  killed = false
  kill(): boolean {
    this.killed = true
    this.emit('close')
    return true
  }
}
const asChild = (c: FakeChild): ChildLike => c as unknown as ChildLike

test('hub: starts lazily, one typeperf per group, reports ok after the first row', () => {
  const kids: Array<{ args: string[]; child: FakeChild }> = []
  const hub = new SensorHub({ supported: true, spawn: (_c, args) => { const child = new FakeChild(); kids.push({ args, child }); return asChild(child) } })
  assert.equal(kids.length, 0)
  assert.equal(hub.read().status.basic, 'starting')
  assert.equal(kids.length, 4)
  assert.ok(kids.every((k) => k.args.includes('-sc') && k.args.includes('-si')))
  const basic = kids.find((k) => k.args.some((a) => a.includes('Processor Frequency')))!
  basic.child.stdout.emit('data', `${HEADER}\r\n"t","1","3200"\r\n"t","50","3200"\r\n`)
  const r = hub.read()
  assert.equal(r.status.basic, 'ok')
  assert.equal(r.cpuMHz, 1600)
  assert.equal(hub.read().status.gpu, 'starting')
  hub.stop()
  assert.ok(kids.every((k) => k.child.killed))
})

test('hub: a group that exits without data is unavailable and does not hurt the others', () => {
  const kids: FakeChild[] = []
  const hub = new SensorHub({ supported: true, spawn: () => { const c = new FakeChild(); kids.push(c); return asChild(c) } })
  hub.read()
  ;(kids[2] as unknown as { stderr: EventEmitter }).stderr.emit('data', 'Error:\r\nNo valid counters.\r\n')
  kids[2]?.emit('close')
  kids[0]?.stdout.emit('data', `${HEADER}\r\n"t","1","3000"\r\n"t","100","3000"\r\n`)
  const r = hub.read()
  assert.equal(r.status.gpu, 'unavailable')
  assert.equal(r.status.basic, 'ok')
  assert.deepEqual(hub.notes()['gpu'], ['Error:', 'No valid counters.'])
  hub.stop()
})

test('hub: restarts a group that ended after producing data (sample limit reached)', () => {
  const kids: FakeChild[] = []
  const hub = new SensorHub({ supported: true, spawn: () => { const c = new FakeChild(); kids.push(c); return asChild(c) } })
  hub.read()
  kids[0]?.stdout.emit('data', `${HEADER}\r\n"t","1","3000"\r\n"t","100","3000"\r\n`)
  const before = kids.length
  kids[0]?.emit('close')
  assert.equal(kids.length, before + 1)
  assert.equal(hub.read().status.basic, 'ok') // last value kept while the new process warms up
  hub.stop()
})

test('hub: unsupported platforms report unavailable without spawning', () => {
  let spawned = 0
  const hub = new SensorHub({ supported: false, spawn: () => { spawned++; return asChild(new FakeChild()) } })
  const r = hub.read()
  assert.equal(spawned, 0)
  assert.equal(r.status.basic, 'unavailable')
  assert.equal(r.cpuMHz, null)
})

test('hub: stops by itself when nobody is reading', async () => {
  let t = 0
  const kids: FakeChild[] = []
  const hub = new SensorHub({ supported: true, idleMs: 50, now: () => t, spawn: () => { const c = new FakeChild(); kids.push(c); return asChild(c) } })
  hub.read()
  t = 10_000
  await new Promise((r) => setTimeout(r, 2200)) // the idle check runs every 2 s
  assert.ok(kids.every((k) => k.killed))
  hub.stop()
})

// ---------- ACPI fallback ----------

import { AcpiThermal } from './acpi.ts'

const THERMAL_FAIL = (kids: FakeChild[]): void => {
  ;(kids[1] as unknown as { stderr: EventEmitter }).stderr.emit('data', 'Error:\r\nNo valid counters.\r\n')
  kids[1]?.emit('close')
}

test('hub: no thermal counter -> falls back to the ACPI temperature and labels it', async () => {
  const kids: FakeChild[] = []
  const acpi = new AcpiThermal(async () => '{"n":"a","t":3182}', 10_000)
  const hub = new SensorHub({ supported: true, acpi, spawn: () => { const c = new FakeChild(); kids.push(c); return asChild(c) } })
  hub.read()
  THERMAL_FAIL(kids)
  hub.read() // starts the ACPI poll
  await new Promise((r) => setTimeout(r, 20))
  const r = hub.read()
  assert.equal(r.tempC, 45.1)
  assert.equal(r.tempSource, 'acpi')
  assert.equal(r.status.thermal, 'ok')
  hub.stop()
  assert.equal(acpi.current.status, 'starting') // stopped with the hub
})

test('hub: ACPI refused -> temperature stays null and the reason is passed on', async () => {
  const kids: FakeChild[] = []
  const acpi = new AcpiThermal(async () => { throw new Error('Access denied') }, 10_000)
  const hub = new SensorHub({ supported: true, acpi, spawn: () => { const c = new FakeChild(); kids.push(c); return asChild(c) } })
  hub.read()
  THERMAL_FAIL(kids)
  hub.read()
  await new Promise((r) => setTimeout(r, 20))
  const r = hub.read()
  assert.equal(r.tempC, null)
  assert.equal(r.status.thermal, 'unavailable')
  assert.match(r.notes?.['thermal']?.[0] ?? '', /administrator/i)
  hub.stop()
})

test('hub: a working thermal counter never starts ACPI', () => {
  const kids: FakeChild[] = []
  let polled = 0
  const acpi = new AcpiThermal(async () => { polled++; return '[]' }, 10_000)
  const hub = new SensorHub({ supported: true, acpi, spawn: () => { const c = new FakeChild(); kids.push(c); return asChild(c) } })
  hub.read()
  kids[1]?.stdout.emit('data', '"(PDH-CSV 4.0)","\\\\PC\\Thermal Zone Information(TZ0)\\Temperature"\r\n"t","0"\r\n"t","318"\r\n')
  const r = hub.read()
  assert.equal(polled, 0)
  assert.equal(r.tempSource, 'counter')
  hub.stop()
})
