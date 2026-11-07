import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listDrives, parseDriveMeta } from './drives.ts'

test('parseDriveMeta handles several disks (array)', () => {
  const json = JSON.stringify([
    { DeviceID: 'C:', VolumeName: 'Windows', DriveType: 3 },
    { DeviceID: 'E:', VolumeName: '', DriveType: 2 },
    { DeviceID: 'Z:', VolumeName: 'Share', DriveType: 4 }
  ])
  const m = parseDriveMeta(json)
  assert.deepEqual(m.get('C'), { label: 'Windows', type: 'fixed' })
  assert.deepEqual(m.get('E'), { label: '', type: 'removable' })
  assert.equal(m.get('Z')?.type, 'network')
})

test('parseDriveMeta handles a single disk (PowerShell returns an object, not an array)', () => {
  const m = parseDriveMeta('{"DeviceID":"C:","VolumeName":"OS","DriveType":3}')
  assert.equal(m.size, 1)
  assert.equal(m.get('C')?.label, 'OS')
})

test('parseDriveMeta ignores garbage', () => {
  assert.equal(parseDriveMeta('').size, 0)
  assert.equal(parseDriveMeta('not json').size, 0)
  assert.equal(parseDriveMeta('[{"DeviceID":"nope"},null,5]').size, 0)
})

test('listDrives reports at least one drive with sane numbers', { skip: process.platform === 'win32' }, async () => {
  const drives = await listDrives()
  assert.ok(drives.length >= 1)
  const d = drives[0]
  assert.ok(d && d.total > 0 && d.free >= 0 && d.free <= d.total)
})
