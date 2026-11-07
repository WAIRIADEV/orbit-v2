import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readPdfAsset, readPdfBytes, validPdfAsset } from './pdfFiles.ts'

test('readPdfBytes: reads a pdf, refuses everything else with a clear message', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbit-pdf-'))
  try {
    const pdf = join(dir, 'a.PDF')
    await writeFile(pdf, '%PDF-1.4 hello')
    const ok = await readPdfBytes(pdf)
    assert.ok(ok.ok && ok.data.length === 14 && ok.data[0] === 0x25)

    const txt = join(dir, 'a.txt')
    await writeFile(txt, 'x')
    assert.deepEqual(await readPdfBytes(txt), { ok: false, message: 'Not a PDF file' })
    assert.deepEqual(await readPdfBytes(join(dir, 'missing.pdf')), { ok: false, message: 'File no longer exists' })
    assert.deepEqual(await readPdfBytes('relative.pdf'), { ok: false, message: 'Invalid path' })
    assert.deepEqual(await readPdfBytes(42), { ok: false, message: 'Invalid path' })
    assert.deepEqual(await readPdfBytes(`${dir}\0.pdf`), { ok: false, message: 'Invalid path' })
    await mkdir(join(dir, 'folder.pdf'))
    assert.deepEqual(await readPdfBytes(join(dir, 'folder.pdf')), { ok: false, message: 'Not a file' })

    const big = await readPdfBytes(pdf, 5)
    assert.ok(!big.ok && /Too large/.test(big.message))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('pdf assets: only cmaps/ and standard_fonts/ plain file names', async () => {
  assert.ok(validPdfAsset('cmaps/UniJIS-UTF16-H.bcmap'))
  assert.ok(validPdfAsset('standard_fonts/FoxitFixed.pfb'))
  for (const bad of ['../package.json', 'cmaps/../package.json', 'cmaps/a/b', 'build/pdf.mjs', 'cmaps/', 'cmaps/a\\b', '', 7, null]) assert.ok(!validPdfAsset(bad), String(bad))

  const root = await mkdtemp(join(tmpdir(), 'orbit-pdfjs-'))
  try {
    await mkdir(join(root, 'cmaps'))
    await writeFile(join(root, 'cmaps', 'x.bcmap'), 'abc')
    await writeFile(join(root, 'secret.txt'), 'nope')
    assert.equal((await readPdfAsset(root, 'cmaps/x.bcmap'))?.length, 3)
    assert.equal(await readPdfAsset(root, 'cmaps/missing.bcmap'), null)
    assert.equal(await readPdfAsset(root, '../secret.txt'), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
