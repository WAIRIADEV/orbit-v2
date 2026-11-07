// PDF engine setup. Imported only by the reader, which is itself loaded on demand, so ORBIT starts without it.
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

// Character maps (for CJK and other non-embedded encodings) and the standard 14 fonts come from the main process
// over IPC, so nothing here needs network or file:// access. A missing file just makes pdf.js fall back.
class IpcCMapReaderFactory {
  async fetch({ name }: { name: string }): Promise<{ cMapData: Uint8Array; isCompressed: boolean }> {
    const data = await window.orbit.pdfAsset(`cmaps/${name}.bcmap`)
    if (!data) throw new Error(`Missing character map ${name}`)
    return { cMapData: data, isCompressed: true }
  }
}

class IpcStandardFontDataFactory {
  async fetch({ filename }: { filename: string }): Promise<Uint8Array> {
    const data = await window.orbit.pdfAsset(`standard_fonts/${filename}`)
    if (!data) throw new Error(`Missing font ${filename}`)
    return data
  }
}

export const documentOptions = {
  cMapUrl: 'ipc:',
  cMapPacked: true,
  standardFontDataUrl: 'ipc:',
  useWorkerFetch: false,
  CMapReaderFactory: IpcCMapReaderFactory,
  StandardFontDataFactory: IpcStandardFontDataFactory
} as const

export { pdfjs }
