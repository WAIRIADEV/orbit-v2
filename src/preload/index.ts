import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types.ts'
import type { AiEvent, ListEvent, OpProgress, OpRequest, OrbitApi, SearchEvent } from '../shared/types.ts'

// The renderer never sees ipcRenderer; it only gets this small, typed surface.
const api: OrbitApi = {
  homeDir: () => ipcRenderer.invoke(IPC.homeDir),
  systemTheme: () => ipcRenderer.invoke(IPC.systemTheme),
  setTheme: (mode) => ipcRenderer.send(IPC.setTheme, mode),
  places: () => ipcRenderer.invoke(IPC.places),
  drives: () => ipcRenderer.invoke(IPC.drives),
  previewText: (path) => ipcRenderer.invoke(IPC.previewText, path),
  openPath: (path) => ipcRenderer.invoke(IPC.openPath, path),
  pdfBytes: (path) => ipcRenderer.invoke(IPC.pdfBytes, path),
  pdfAsset: (rel) => ipcRenderer.invoke(IPC.pdfAsset, rel),
  aiStatus: () => ipcRenderer.invoke(IPC.aiStatus),
  aiSetKey: (key) => ipcRenderer.invoke(IPC.aiSetKey, key),
  aiClearKey: () => ipcRenderer.invoke(IPC.aiClearKey),
  aiAsk: (requestId, messages, context) => ipcRenderer.send(IPC.aiAsk, requestId, messages, context),
  aiCancel: (requestId) => ipcRenderer.send(IPC.aiCancel, requestId),
  onAiEvent: (cb) => {
    const handler = (_: unknown, e: AiEvent): void => cb(e)
    ipcRenderer.on(IPC.aiEvent, handler)
    return () => ipcRenderer.removeListener(IPC.aiEvent, handler)
  },
  revealPath: (path) => ipcRenderer.send(IPC.revealPath, path),
  copyText: (text) => ipcRenderer.send(IPC.copyText, text),
  binList: () => ipcRenderer.invoke(IPC.binList),
  binRestore: (ids) => ipcRenderer.invoke(IPC.binRestore, ids),
  binPurge: (ids) => ipcRenderer.invoke(IPC.binPurge, ids),
  binEmpty: () => ipcRenderer.invoke(IPC.binEmpty),
  perf: () => ipcRenderer.invoke(IPC.perf),
  sysSample: () => ipcRenderer.invoke(IPC.sysSample),
  sensors: () => ipcRenderer.invoke(IPC.sensors),
  sensorsStop: () => ipcRenderer.send(IPC.sensorsStop),

  listDir: (requestId, path) => ipcRenderer.send(IPC.listDir, requestId, path),
  cancelList: (requestId) => ipcRenderer.send(IPC.cancelList, requestId),
  onListEvent: (cb) => {
    const handler = (_: unknown, e: ListEvent): void => cb(e)
    ipcRenderer.on(IPC.listEvent, handler)
    return () => ipcRenderer.removeListener(IPC.listEvent, handler)
  },

  search: (requestId, root, query) => ipcRenderer.send(IPC.search, requestId, root, query),
  cancelSearch: (requestId) => ipcRenderer.send(IPC.cancelSearch, requestId),
  onSearchEvent: (cb) => {
    const handler = (_: unknown, e: SearchEvent): void => cb(e)
    ipcRenderer.on(IPC.searchEvent, handler)
    return () => ipcRenderer.removeListener(IPC.searchEvent, handler)
  },

  enqueue: (req: OpRequest) => ipcRenderer.invoke(IPC.enqueue, req),
  cancelOp: (id) => ipcRenderer.send(IPC.cancelOp, id),
  undo: () => ipcRenderer.invoke(IPC.undo),
  onOpProgress: (cb) => {
    const handler = (_: unknown, p: OpProgress): void => cb(p)
    ipcRenderer.on(IPC.opProgress, handler)
    return () => ipcRenderer.removeListener(IPC.opProgress, handler)
  }
}

contextBridge.exposeInMainWorld('orbit', api)
