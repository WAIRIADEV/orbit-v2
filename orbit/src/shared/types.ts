// Shared between main, preload and renderer. Types only: no runtime imports here.

export interface FileEntry {
  name: string
  path: string
  isDir: boolean
  isSymlink: boolean
  size: number
  mtimeMs: number
}

export type ListEvent =
  | { requestId: number; type: 'chunk'; entries: FileEntry[] }
  | { requestId: number; type: 'done'; total: number; ms: number }
  | { requestId: number; type: 'error'; message: string }

export type SearchEvent =
  | { requestId: number; type: 'chunk'; entries: FileEntry[] }
  | { requestId: number; type: 'done'; total: number; ms: number; limited: boolean }
  | { requestId: number; type: 'error'; message: string }

export type DriveType = 'fixed' | 'removable' | 'network' | 'optical' | 'unknown'

export interface DriveInfo {
  /** Root path, e.g. "C:\\" (always with the backslash). */
  path: string
  /** Display name, e.g. "Windows (C:)" or "USB Drive (E:)". */
  name: string
  type: DriveType
  total: number
  free: number
}

export type PlaceIcon =
  | 'home'
  | 'desktop'
  | 'documents'
  | 'downloads'
  | 'pictures'
  | 'music'
  | 'videos'

export interface Place {
  name: string
  path: string
  icon: PlaceIcon
}

export type ThemeMode = 'dark' | 'light'

export type TextPreview =
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'binary' }
  | { kind: 'error'; message: string }

export type OpKind = 'copy' | 'move' | 'rename' | 'trash' | 'mkdir' | 'newfile' | 'zip' | 'unzip'

export interface OpRequest {
  kind: OpKind
  /** Source paths. */
  sources: string[]
  /** Destination directory (copy/move) or new base name (rename, single source). */
  target?: string
  /** mkdir / newfile: the name to try (a number is added if it is taken). */
  name?: string
  /** unzip: into a new folder named after the archive, or straight into its own folder. */
  mode?: 'folder' | 'here'
}

export type OpStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface OpProgress {
  id: number
  kind: OpKind
  status: OpStatus
  /** Items finished out of items total. */
  done: number
  total: number
  current?: string
  /** zip / unzip: 0..100 by bytes. */
  percent?: number
  /** mkdir / newfile / zip / unzip: the path that was created. */
  created?: string
  error?: string
}

export interface UndoResult {
  ok: boolean
  message: string
}

/** One item in the Windows Recycle Bin. `id` is the item's path inside $Recycle.Bin. */
export interface BinEntry {
  id: string
  name: string
  isDir: boolean
  size: number
  /** When it was deleted (ms since epoch), 0 if unknown. */
  deletedMs: number
  /** The folder it was deleted from. */
  from: string
}

export interface BinList {
  /** false on platforms where the Recycle Bin view is not available. */
  supported: boolean
  items: BinEntry[]
  error?: string
}

export interface BinResult {
  ok: boolean
  done: number
  message: string
}

export interface PerfPart {
  /** "Main", "Interface", "Graphics", "Helper" ... */
  name: string
  count: number
  /** % of the whole machine. */
  cpu: number
  memMB: number
}

/** ORBIT's own resource use (all of its processes together). */
export interface PerfSample {
  /** % of the whole machine's CPU. */
  cpu: number
  memMB: number
  processes: number
  parts: PerfPart[]
}

/** One reading of the whole machine, for the System Monitor page. */
export interface SysSample {
  cpuModel: string
  /** Busy % per logical core since the previous sample. */
  cores: number[]
  /** Average of `cores`. */
  cpu: number
  /** The clock Windows reports for the CPU: the base speed, not the live boost clock. */
  baseMHz: number
  memTotal: number
  memUsed: number
  uptimeSec: number
}

/** Live readings from Windows performance counters. null = this PC does not provide it (shown as N/A). */
export interface SensorReading {
  /** Live CPU clock (nominal frequency x current performance %). */
  cpuMHz: number | null
  tempC: number | null
  gpuPct: number | null
  vramMB: number | null
  diskBusyPct: number | null
  diskReadBps: number | null
  diskWriteBps: number | null
  netRxBps: number | null
  netTxBps: number | null
  /** The CPU's nominal speed and the performance % Windows reported, so a doubtful live clock can be explained. */
  cpuNominalMHz: number | null
  cpuPerfPct: number | null
  /** vramMB is shared system memory (integrated GPU), not dedicated video memory. */
  vramShared: boolean
  /** Where tempC came from: a performance counter, or the less precise ACPI thermal zone. */
  tempSource: 'counter' | 'acpi' | null
  status: Record<'basic' | 'thermal' | 'gpu' | 'vram', 'starting' | 'ok' | 'unavailable'>
  /** typeperf's own messages for groups that failed, to explain an N/A. */
  notes?: Record<string, string[]>
}

/** The API exposed on window.orbit by the preload script. */
export interface OrbitApi {
  homeDir(): Promise<string>
  /** The system theme preference, used for the first launch only. */
  systemTheme(): Promise<ThemeMode>
  /** Recolors the native window buttons to match the theme. */
  setTheme(mode: ThemeMode): void
  places(): Promise<Place[]>
  drives(): Promise<DriveInfo[]>
  /** First 64 KB of a text file for Quick Look. */
  previewText(path: string): Promise<TextPreview>
  /** Opens a file in its default app. Resolves to '' on success, or an error message. */
  openPath(path: string): Promise<string>
  /** Reads a PDF for the built-in reader. */
  pdfBytes(path: string): Promise<PdfBytes>
  /** A character map or standard font file of the PDF engine (null if missing). */
  pdfAsset(rel: string): Promise<Uint8Array | null>
  /** Shows the item selected in Windows Explorer. */
  revealPath(path: string): void
  copyText(text: string): void

  binList(): Promise<BinList>
  binRestore(ids: string[]): Promise<BinResult>
  /** Permanently deletes the given items. The renderer asks the person to confirm first. */
  binPurge(ids: string[]): Promise<BinResult>
  binEmpty(): Promise<BinResult>

  perf(): Promise<PerfSample>
  /** CPU load is the change since the previous call, so poll this at a steady rate (once a second). */
  sysSample(): Promise<SysSample>
  /** Starts the sensor readers on first call. Call sensorsStop() when the page closes. */
  sensors(): Promise<SensorReading>
  sensorsStop(): void

  /**
   * Starts a streamed listing. The renderer picks the request id, so events can never
   * arrive before the id is known. Chunks come back through onListEvent.
   */
  listDir(requestId: number, path: string): void
  cancelList(requestId: number): void
  onListEvent(cb: (e: ListEvent) => void): () => void

  /** Recursive name search below root. Results stream through onSearchEvent. */
  search(requestId: number, root: string, query: string): void
  cancelSearch(requestId: number): void
  onSearchEvent(cb: (e: SearchEvent) => void): () => void

  /** AI copilot. The Groq key lives in the main process only. */
  aiStatus(): Promise<AiStatus>
  aiSetKey(key: string): Promise<{ ok: boolean; message: string }>
  aiClearKey(): Promise<void>
  aiAsk(requestId: number, messages: AiMessage[], context: AiContext): void
  aiCancel(requestId: number): void
  onAiEvent(cb: (e: AiEvent) => void): () => void

  enqueue(req: OpRequest): Promise<number>
  cancelOp(id: number): void
  undo(): Promise<UndoResult>
  onOpProgress(cb: (p: OpProgress) => void): () => void
}

export const IPC = {
  homeDir: 'fs:homeDir',
  systemTheme: 'ui:systemTheme',
  setTheme: 'ui:setTheme',
  places: 'fs:places',
  drives: 'fs:drives',
  previewText: 'preview:text',
  openPath: 'shell:openPath',
  aiStatus: 'ai:status',
  aiSetKey: 'ai:setKey',
  aiClearKey: 'ai:clearKey',
  aiAsk: 'ai:ask',
  aiCancel: 'ai:cancel',
  aiEvent: 'ai:event',
  pdfBytes: 'pdf:bytes',
  pdfAsset: 'pdf:asset',
  revealPath: 'shell:reveal',
  copyText: 'shell:copyText',
  binList: 'bin:list',
  binRestore: 'bin:restore',
  binPurge: 'bin:purge',
  binEmpty: 'bin:empty',
  perf: 'perf:sample',
  sysSample: 'sys:sample',
  sensors: 'sys:sensors',
  sensorsStop: 'sys:sensors-stop',
  listDir: 'fs:listDir',
  cancelList: 'fs:cancelList',
  listEvent: 'fs:listEvent',
  search: 'search:start',
  cancelSearch: 'search:cancel',
  searchEvent: 'search:event',
  enqueue: 'ops:enqueue',
  cancelOp: 'ops:cancel',
  undo: 'ops:undo',
  opProgress: 'ops:progress'
} as const

export type PdfBytes = { ok: true; data: Uint8Array } | { ok: false; message: string }

// ---------- AI copilot ----------

export interface AiStatus {
  hasKey: boolean
  /** The key can be stored encrypted on this PC (otherwise it only lives until ORBIT closes). */
  canEncrypt: boolean
  model: string
}

export interface AiMessage {
  role: 'user' | 'assistant'
  content: string
}

/** What the person is looking at, sent with every question so "this folder" and "this PDF" mean something. */
export interface AiContext {
  cwd: string | null
  otherPane: string | null
  selected: string[]
  pdf: { path: string; page: number } | null
}

export type PlanAction =
  | { type: 'mkdir'; parent: string; name: string }
  | { type: 'move'; paths: string[]; to: string }
  | { type: 'copy'; paths: string[]; to: string }
  | { type: 'rename'; path: string; newName: string }
  | { type: 'trash'; paths: string[] }

/** Changes the AI wants to make. Nothing runs until the person clicks Apply. */
export interface AiPlan {
  title: string
  actions: PlanAction[]
}

export type AiEvent =
  | { requestId: number; type: 'tool'; label: string }
  | { requestId: number; type: 'plan'; plan: AiPlan }
  | { requestId: number; type: 'done'; text: string }
  | { requestId: number; type: 'error'; message: string; code: 'no-key' | 'bad-key' | 'rate' | 'network' | 'other' }
