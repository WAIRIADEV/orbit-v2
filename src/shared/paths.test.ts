import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parentPath, normalizeRoot, isRoot, breadcrumbs } from './paths.ts'

test('breadcrumbs: windows paths', () => {
  assert.deepEqual(breadcrumbs('C:\\Users\\Tony'), [
    { label: 'C:', path: 'C:\\' },
    { label: 'Users', path: 'C:\\Users' },
    { label: 'Tony', path: 'C:\\Users\\Tony' }
  ])
  assert.deepEqual(breadcrumbs('C:'), [{ label: 'C:', path: 'C:\\' }])
})

test('breadcrumbs: posix paths', () => {
  assert.deepEqual(breadcrumbs('/home/tony'), [
    { label: '/', path: '/' },
    { label: 'home', path: '/home' },
    { label: 'tony', path: '/home/tony' }
  ])
  assert.deepEqual(breadcrumbs('/'), [{ label: '/', path: '/' }])
})

test('windows: parent of a top-level folder is the drive root with a backslash', () => {
  assert.equal(parentPath('C:\\Users'), 'C:\\')
  assert.equal(parentPath('C:\\Users\\Administrator'), 'C:\\Users')
  assert.equal(parentPath('C:\\Users\\Administrator\\'), 'C:\\Users')
})

test('windows: a drive root is its own parent, and "C:" is normalised', () => {
  assert.equal(parentPath('C:\\'), 'C:\\')
  assert.equal(parentPath('C:'), 'C:\\')
  assert.equal(normalizeRoot('D:'), 'D:\\')
  assert.equal(isRoot('C:\\'), true)
  assert.equal(isRoot('C:\\Users'), false)
})

test('posix paths still work', () => {
  assert.equal(parentPath('/home/tony'), '/home')
  assert.equal(parentPath('/home'), '/')
  assert.equal(parentPath('/'), '/')
})
