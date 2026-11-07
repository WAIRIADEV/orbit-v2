import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeTheme, net, protocol, safeStorage, shell } from 'electron'
import { pathToFileURL } from 'node:url'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { IPC } from '../shared/types.ts'
import type {
  ListEvent,
  OpProgress,
  OpRequest,
  Place,
  PlaceIcon,
  SearchEvent,
  ThemeMode
} from '../shared/types.ts'
import { normalizeRoot } from '../shared/paths.ts'
import { MEDIA_SCHEME, pathFromMediaUrl } from '../shared/mediaUrl.ts'
import { readTextPreview } from './ops/preview.ts'
import { checkOpenable } from './ops/openPath.ts'
import { ThumbnailService } from './ops/thumbs.ts'
import { RecycleBinService } from './ops/recycle.ts'
import { summarizeMetrics } from './ops/perf.ts'
import { cpus, freemem, totalmem, uptime } from 'node:os'
import { SystemSampler } from './ops/sysinfo.ts'
import { SensorHub } from './ops/counters.ts'
import { AcpiThermal, powershellRun } from './ops/acpi.ts'
import { readPdfAsset, readPdfBytes } from './ops/pdfFiles.ts'
import { AiService } from './ai/service.ts'
import { KeyStore } from './ai/keystore.ts'
import { realToolDeps } from './ai/realDeps.ts'
import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { makeThumbnail } from './thumbGenerator.ts'
import { readFile } from 'node:fs/promises'
import { listDrives } from './ops/drives.ts'
import { streamDirectory } from './ops/list.ts'
import { OperationQueue } from './ops/queue.ts'
import { searchTree } from './ops/search.ts'

// Must run before the app is ready. "stream" lets <video> and <audio> read the file progressively.
protocol.registerSchemesAsPrivileged([
  { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

const isDev = !app.isPackaged
const THEME_CHROME: Record<ThemeMode, { bg: string; symbol: string }> = {
  dark: { bg: '#141418', symbol: '#e6e6ec' },
  light: { bg: '#f1f3fb', symbol: '#1b1b21' }
}
const BG = THEME_CHROME.dark.bg

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 860,
    minHeight: 520,
    show: false, // show only when first paint is ready: feels faster, no white flash
    backgroundColor: BG,
    icon: join(__dirname, '../../resources/icon.png'),
    // Modern Windows 11 look: our own title bar, native min/max/close buttons drawn on top of it.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BG, symbolColor: '#e6e6ec', height: 44 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.once('ready-to-show', () => win.show())

  if (isDev) {
    // F12 / Ctrl+Shift+I for DevTools while developing (the default menu is gone).
    win.webContents.on('before-input-event', (_e, input) => {
      const toggle = input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')
      if (toggle && input.type === 'keyDown') win.webContents.toggleDevTools()
    })
  }

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

const PLACE_DEFS: Array<[PlaceIcon, string]> = [
  ['home', 'Home'],
  ['desktop', 'Desktop'],
  ['documents', 'Documents'],
  ['downloads', 'Downloads'],
  ['pictures', 'Pictures'],
  ['music', 'Music'],
  ['videos', 'Videos']
]

async function listPlaces(): Promise<Place[]> {
  const out: Place[] = []
  for (const [icon, name] of PLACE_DEFS) {
    try {
      const path = app.getPath(icon)
      await access(path)
      // The home folder is labelled with the account name (e.g. "Administrator"), not "Home".
      out.push({ name: icon === 'home' ? basename(path) : name, path, icon })
    } catch {
      // folder missing or redirected somewhere unreachable: just leave it out
    }
  }
  return out
}

function registerIpc(win: BrowserWindow): void {
  const send = (channel: string, payload: unknown): void => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }

  ipcMain.handle(IPC.homeDir, () => homedir())
  ipcMain.handle(IPC.systemTheme, (): ThemeMode => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'))
  ipcMain.on(IPC.setTheme, (_e, mode: ThemeMode) => {
    if (mode !== 'dark' && mode !== 'light') return
    const c = THEME_CHROME[mode]
    win.setBackgroundColor(c.bg)
    // The native min/max/close buttons sit on our title bar, so they must follow the theme.
    if (process.platform === 'win32') win.setTitleBarOverlay({ color: c.bg, symbolColor: c.symbol, height: 44 })
  })
  ipcMain.handle(IPC.places, () => listPlaces())
  ipcMain.handle(IPC.drives, () => listDrives())
  ipcMain.handle(IPC.previewText, (_e, path: string) => readTextPreview(path))
  // The user's SID names their folder inside $Recycle.Bin. `whoami` is a plain Windows executable (no PowerShell).
  let sidCache: Promise<string | null> | null = null
  const currentSid = (): Promise<string | null> =>
    (sidCache ??= new Promise((resolve) => {
      execFile('whoami', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true, timeout: 10_000 }, (err, out) => {
        const m = err ? null : /"(S-1-[0-9-]+)"\s*$/m.exec(out)
        resolve(m?.[1] ?? null)
      })
    }))
  const recycle = new RecycleBinService(
    {
      roots: async () => (await listDrives()).filter((d) => d.type !== 'network' && d.type !== 'optical').map((d) => d.path),
      sid: currentSid
    },
    process.platform === 'win32'
  )
  ipcMain.handle(IPC.binList, () => recycle.list())
  ipcMain.handle(IPC.binRestore, (_e, ids: unknown) => recycle.restore(ids))
  ipcMain.handle(IPC.binPurge, (_e, ids: unknown) => recycle.purge(ids))
  ipcMain.handle(IPC.binEmpty, () => recycle.empty())
  const sampler = new SystemSampler({ cpus, totalmem, freemem, uptime })
  ipcMain.handle(IPC.sysSample, () => sampler.sample())
  const sensorHub = new SensorHub({
    spawn: (cmd, args) => spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }),
    supported: process.platform === 'win32',
    acpi: new AcpiThermal(powershellRun)
  })
  ipcMain.handle(IPC.sensors, () => {
    const r = sensorHub.read()
    return { ...r, notes: { ...sensorHub.notes(), ...(r.notes ?? {}) } } // the ACPI reason replaces typeperf's message
  })
  ipcMain.on(IPC.sensorsStop, () => sensorHub.stop())
  app.on('before-quit', () => sensorHub.stop())
  ipcMain.handle(IPC.perf, () => summarizeMetrics(app.getAppMetrics(), cpus().length))
  ipcMain.on(IPC.copyText, (_e, text: unknown) => {
    if (typeof text === 'string' && text.length < 1_000_000) clipboard.writeText(text)
  })
  ipcMain.on(IPC.revealPath, async (_e, path: unknown) => {
    if (!(await checkOpenable(path))) shell.showItemInFolder(path as string)
  })
  // AI copilot: the Groq key and every request to Groq stay in this process.
  const ai = new AiService({
    keys: new KeyStore(join(app.getPath('userData'), 'groq.key'), safeStorage),
    send: (e) => send(IPC.aiEvent, e),
    deps: realToolDeps,
    system: () => ({ home: homedir(), platform: process.platform, now: new Date() })
  })
  ipcMain.handle(IPC.aiStatus, () => ai.status())
  ipcMain.handle(IPC.aiSetKey, (_e, key: unknown) => ai.setKey(key))
  ipcMain.handle(IPC.aiClearKey, () => ai.clearKey())
  ipcMain.on(IPC.aiAsk, (_e, requestId: number, messages: unknown, context: unknown) => void ai.ask(requestId, messages, context))
  ipcMain.on(IPC.aiCancel, (_e, requestId: number) => ai.cancel(requestId))
  ipcMain.handle(IPC.pdfBytes, (_e, path: unknown) => readPdfBytes(path))
  ipcMain.handle(IPC.pdfAsset, (_e, rel: unknown) => readPdfAsset(join(app.getAppPath(), 'node_modules', 'pdfjs-dist'), rel))
  ipcMain.handle(IPC.openPath, async (_e, path: unknown): Promise<string> => {
    const problem = await checkOpenable(path)
    if (problem) return problem
    return shell.openPath(path as string) // '' on success, otherwise an error message
  })

  // ---- Directory listing (streamed). The renderer chooses the request id. ----
  const listControllers = new Map<number, AbortController>()

  ipcMain.on(IPC.listDir, (_e, requestId: number, rawPath: string) => {
    const path = normalizeRoot(rawPath) // "C:" would mean "current folder on C:", not the drive root
    const controller = new AbortController()
    listControllers.set(requestId, controller)
    const started = performance.now()
    const emit = (e: ListEvent): void => send(IPC.listEvent, e)

    streamDirectory(path, (entries) => emit({ requestId, type: 'chunk', entries }), controller.signal)
      .then((total) => {
        if (!controller.signal.aborted) {
          emit({ requestId, type: 'done', total, ms: Math.round(performance.now() - started) })
        }
      })
      .catch((err: Error) => emit({ requestId, type: 'error', message: err.message }))
      .finally(() => listControllers.delete(requestId))
  })

  ipcMain.on(IPC.cancelList, (_e, requestId: number) => {
    listControllers.get(requestId)?.abort()
  })

  // ---- Recursive search ----
  const searchControllers = new Map<number, AbortController>()

  ipcMain.on(IPC.search, (_e, requestId: number, root: string, query: string) => {
    const controller = new AbortController()
    searchControllers.set(requestId, controller)
    const started = performance.now()
    const emit = (e: SearchEvent): void => send(IPC.searchEvent, e)

    searchTree(normalizeRoot(root), query, (entries) => emit({ requestId, type: 'chunk', entries }), controller.signal)
      .then((r) => {
        if (!controller.signal.aborted) {
          emit({
            requestId,
            type: 'done',
            total: r.total,
            limited: r.limited,
            ms: Math.round(performance.now() - started)
          })
        }
      })
      .catch((err: Error) => emit({ requestId, type: 'error', message: err.message }))
      .finally(() => searchControllers.delete(requestId))
  })

  ipcMain.on(IPC.cancelSearch, (_e, requestId: number) => {
    searchControllers.get(requestId)?.abort()
  })

  // ---- Operations ----
  const queue = new OperationQueue(
    (path) => shell.trashItem(path),
    (p: OpProgress) => send(IPC.opProgress, p)
  )
  ipcMain.handle(IPC.enqueue, (_e, req: OpRequest) => queue.enqueue(req))
  ipcMain.on(IPC.cancelOp, (_e, id: number) => queue.cancel(id))
  ipcMain.handle(IPC.undo, () => queue.undo())
}

void app.whenReady().then(() => {
  Menu.setApplicationMenu(null) // our own UI replaces the default File/Edit/View menu

  // Serves local files to the renderer for Quick Look, so webSecurity can stay ON.
  // Range headers are forwarded so video seeking works.
  const thumbs = new ThumbnailService({ cacheDir: join(app.getPath('userData'), 'thumbs'), generate: makeThumbnail })

  protocol.handle(MEDIA_SCHEME, async (request) => {
    const thumbPath = pathFromMediaUrl(request.url, 'thumb')
    if (thumbPath) {
      // request.signal aborts when the tile scrolls away (the <img> is unmounted), so queued work is skipped.
      const file = await thumbs.get(thumbPath, request.signal)
      if (!file) return new Response('No thumbnail', { status: 404 })
      return new Response(await readFile(file), {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=31536000, immutable' }
      })
    }
    const path = pathFromMediaUrl(request.url)
    if (!path) return new Response('Bad request', { status: 400 })
    return net.fetch(pathToFileURL(path).toString(), { method: request.method, headers: request.headers })
  })

  const win = createWindow()
  registerIpc(win)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) registerIpc(createWindow())
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
