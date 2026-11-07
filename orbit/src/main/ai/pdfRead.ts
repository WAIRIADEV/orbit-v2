import { readFile } from 'node:fs/promises'

export interface PdfPages {
  pages: number
  from: number
  to: number
  text: string
  truncated: boolean
}

const MAX_BYTES = 100 * 1024 * 1024

/** Text of a page range, for the AI. Uses pdf.js's Node build (loaded on first use). */
export async function readPdfPages(path: string, from = 1, to = from + 2, maxChars = 6000): Promise<PdfPages | { error: string }> {
  try {
    const buf = await readFile(path)
    if (buf.length > MAX_BYTES) return { error: 'PDF is too large to read here' }
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
      verbosity: 0,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false
    }).promise
    try {
      const a = Math.min(Math.max(1, Math.floor(from) || 1), doc.numPages)
      const b = Math.min(Math.max(a, Math.floor(to) || a), doc.numPages, a + 9) // at most 10 pages per call
      let text = ''
      let last = a - 1
      let truncated = false
      for (let p = a; p <= b; p++) {
        const page = await doc.getPage(p)
        const tc = await page.getTextContent()
        let t = ''
        for (const it of tc.items) if ('str' in it) t += it.hasEOL ? `${it.str}\n` : it.str
        t = t.replace(/[ \t]+\n/g, '\n').trim()
        const block = `--- page ${p} ---\n${t || '(no text on this page: it may be a scan)'}\n`
        if (text.length + block.length > maxChars) {
          truncated = true
          text += block.slice(0, Math.max(0, maxChars - text.length))
          last = p
          break
        }
        text += block
        last = p
      }
      return { pages: doc.numPages, from: a, to: last, text, truncated }
    } finally {
      await doc.destroy()
    }
  } catch (e) {
    const name = (e as { name?: string }).name
    if (name === 'PasswordException') return { error: 'This PDF is password protected' }
    if (name === 'InvalidPDFException') return { error: 'Not a valid PDF' }
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { error: 'File does not exist' }
    return { error: (e as Error).message }
  }
}
