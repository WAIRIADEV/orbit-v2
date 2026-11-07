import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readPdfPages } from './pdfRead.ts'

/** A tiny valid PDF with one line of Helvetica text per page. */
function tinyPdf(pages: string[]): Buffer {
  const objs: string[] = []
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')
  objs.push('<< /Type /Catalog /Pages 2 0 R >>')
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`)
  pages.forEach((t, i) => {
    const content = `BT /F1 18 Tf 50 700 Td (${t}) Tj ET`
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${4 + i * 2} 0 R >>`)
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
  })
  let out = '%PDF-1.4\n'
  const offs: number[] = []
  objs.forEach((o, i) => {
    offs.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(out, 'latin1')
}

test('readPdfPages: reads the requested pages with page markers and the total count', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbit-pdftext-'))
  try {
    const file = join(dir, 'book.pdf')
    await writeFile(file, tinyPdf(['Alpha page one', 'Bravo page two', 'Charlie page three', 'Delta page four']))
    const r = await readPdfPages(file, 2, 3)
    assert.ok(!('error' in r))
    if ('error' in r) return
    assert.equal(r.pages, 4)
    assert.equal(r.from, 2)
    assert.equal(r.to, 3)
    assert.match(r.text, /--- page 2 ---\nBravo page two/)
    assert.match(r.text, /--- page 3 ---\nCharlie page three/)
    assert.ok(!r.text.includes('Alpha'))

    const clamped = await readPdfPages(file, 4, 99)
    assert.ok(!('error' in clamped) && clamped.from === 4 && clamped.to === 4 && /Delta/.test(clamped.text))
    const past = await readPdfPages(file, 50, 60)
    assert.ok(!('error' in past) && past.from === 4)

    const cut = await readPdfPages(file, 1, 4, 60)
    assert.ok(!('error' in cut) && cut.truncated && cut.text.length <= 60)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('readPdfPages: readable errors for junk, missing files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbit-pdftext-'))
  try {
    const junk = join(dir, 'junk.pdf')
    await writeFile(junk, 'definitely not a pdf')
    assert.deepEqual(await readPdfPages(junk), { error: 'Not a valid PDF' })
    assert.deepEqual(await readPdfPages(join(dir, 'missing.pdf')), { error: 'File does not exist' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
