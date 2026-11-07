import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AcpiThermal, explainAcpiError, parseAcpiTemps } from './acpi.ts'

// 3182 tenths of a Kelvin = 318.2 K = 45.05 C
test('parseAcpiTemps: array, single object, hottest sane zone wins', () => {
  assert.equal(parseAcpiTemps('[{"n":"a","t":3182},{"n":"b","t":3282}]'), 55.1)
  assert.equal(parseAcpiTemps('{"n":"a","t":3182}'), 45.1)
  assert.equal(parseAcpiTemps('﻿{"n":"a","t":3182}\r\n'), 45.1)
})

test('parseAcpiTemps: junk and out-of-range values give null', () => {
  assert.equal(parseAcpiTemps(''), null)
  assert.equal(parseAcpiTemps('not json'), null)
  assert.equal(parseAcpiTemps('[{"n":"a","t":0}]'), null) // -273 C
  assert.equal(parseAcpiTemps('[{"n":"a","t":5000}]'), null) // 226 C
  assert.equal(parseAcpiTemps('[{"n":"a","t":"hot"},null]'), null)
  assert.equal(parseAcpiTemps('[{"n":"a","t":0},{"n":"b","t":3182}]'), 45.1) // bad zone ignored
})

test('explainAcpiError: names the real cause', () => {
  assert.match(explainAcpiError('Get-CimInstance : Access denied'), /administrator/i)
  assert.match(explainAcpiError('Not supported'), /does not expose/)
  assert.equal(explainAcpiError('Something odd\r\nsecond line'), 'Something odd')
  assert.match(explainAcpiError(''), /does not expose/)
})

test('AcpiThermal: ok, then unavailable on error, and never runs two queries at once', async () => {
  let calls = 0
  let release: (v: string) => void = () => {}
  const t = new AcpiThermal(() => { calls++; return new Promise<string>((r) => (release = r)) }, 10_000)
  const p1 = t.poll()
  const p2 = t.poll() // busy: ignored
  assert.equal(calls, 1)
  release('{"n":"a","t":3182}')
  await Promise.all([p1, p2])
  assert.deepEqual(t.current, { status: 'ok', tempC: 45.1, reason: null })

  const bad = new AcpiThermal(async () => { throw new Error('Access denied') }, 10_000)
  await bad.poll()
  assert.equal(bad.current.status, 'unavailable')
  assert.match(bad.current.reason ?? '', /administrator/i)

  const empty = new AcpiThermal(async () => '[]', 10_000)
  await empty.poll()
  assert.equal(empty.current.status, 'unavailable')
})

test('AcpiThermal: start polls once immediately, stop resets and halts', async () => {
  let calls = 0
  const t = new AcpiThermal(async () => { calls++; return '{"n":"a","t":3182}' }, 20)
  t.start()
  t.start() // idempotent
  await new Promise((r) => setTimeout(r, 70))
  assert.ok(calls >= 2)
  assert.equal(t.current.status, 'ok')
  t.stop()
  const n = calls
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(calls, n)
  assert.equal(t.current.status, 'starting')
})
