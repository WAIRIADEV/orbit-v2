import type { AiPlan, FileEntry, TextPreview } from '../../shared/types.ts'
import { baseName } from '../../shared/paths.ts'
import type { PdfPages } from './pdfRead.ts'
import type { PlanResult } from './plan.ts'

const ABSOLUTE = /^([a-z]:[\\/]|\\\\|\/)/i
const LIST_MAX = 150
const SEARCH_MAX = 40
export const READ_CHARS = 6000

/** Files the model is never shown, whatever it asks for: keys, tokens, password stores. */
export function isSecretPath(path: string): boolean {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  if (parts.some((p) => /^\.(ssh|gnupg|aws|kube|azure)$/i.test(p))) return true
  const name = (parts[parts.length - 1] ?? '').toLowerCase()
  if (/^\.env(\..*)?$/.test(name)) return true
  if (/\.(pem|key|pfx|p12|ppk|kdbx|keystore|jks)$/.test(name)) return true
  if (/^id_(rsa|dsa|ecdsa|ed25519)/.test(name)) return true
  if (['login data', 'cookies', 'web data', 'key4.db', 'logins.json', '.npmrc', '.netrc', '.git-credentials'].includes(name)) return true
  return false
}

export interface ToolDeps {
  listDir(path: string): Promise<FileEntry[] | { error: string }>
  search(root: string, query: string, limit: number): Promise<{ results: FileEntry[]; limited: boolean } | { error: string }>
  readText(path: string): Promise<TextPreview>
  stat(path: string): Promise<FileEntry | null>
  readPdf(path: string, from: number, to: number): Promise<PdfPages | { error: string }>
  validatePlan(raw: unknown): Promise<PlanResult>
}

export interface ToolOutcome {
  /** What the model gets back. */
  text: string
  /** One short line for the person ("Looked in Documents"). */
  label: string
}

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[]): unknown => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } }
})

const PATH = { type: 'string', description: 'Absolute path, e.g. C:\\Users\\Tony\\Documents' }

export const TOOL_DEFS: unknown[] = [
  fn('list_folder', 'List the files and folders inside a folder (names, sizes, dates).', { path: PATH }, ['path']),
  fn('search_files', 'Find files or folders by name under a folder. All words must appear in the name.', { root: PATH, query: { type: 'string' } }, ['root', 'query']),
  fn('read_text_file', 'Read the start of a text, code, or data file.', { path: PATH }, ['path']),
  fn(
    'read_pdf',
    'Read the text of pages of a PDF (up to 10 pages per call). Pages start at 1.',
    { path: PATH, from_page: { type: 'integer' }, to_page: { type: 'integer' } },
    ['path']
  ),
  fn('file_info', 'Size, type and modified date of one file or folder.', { path: PATH }, ['path']),
  fn(
    'propose_changes',
    'Propose file changes for the person to review. Nothing happens until they click Apply. Check real names with list_folder first. Folders you create (mkdir) may be used by later actions in the same plan.',
    {
      title: { type: 'string', description: 'Short summary, e.g. "Sort 14 invoices into Invoices"' },
      actions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['mkdir', 'move', 'copy', 'rename', 'trash'] },
            parent: { type: 'string', description: 'mkdir: folder to create it in' },
            name: { type: 'string', description: 'mkdir: new folder name' },
            paths: { type: 'array', items: { type: 'string' }, description: 'move, copy, trash: absolute paths' },
            to: { type: 'string', description: 'move, copy: destination folder' },
            path: { type: 'string', description: 'rename: the item' },
            newName: { type: 'string', description: 'rename: new name only, not a path' }
          },
          required: ['type']
        }
      }
    },
    ['title', 'actions']
  )
]

const size = (n: number): string => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(1)} GB`)
const day = (ms: number): string => (ms > 0 ? new Date(ms).toISOString().slice(0, 10) : '?')

function absPath(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 && !v.includes('\0') && ABSOLUTE.test(v) ? v : null
}

export class Toolbox {
  private readonly d: ToolDeps
  /** The last plan the model proposed that passed validation. */
  plan: AiPlan | null = null

  constructor(deps: ToolDeps) {
    this.d = deps
  }

  async run(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
    try {
      switch (name) {
        case 'list_folder':
          return await this.list(args)
        case 'search_files':
          return await this.search(args)
        case 'read_text_file':
          return await this.readText(args)
        case 'read_pdf':
          return await this.readPdf(args)
        case 'file_info':
          return await this.info(args)
        case 'propose_changes':
          return await this.propose(args)
        default:
          return { text: `Error: there is no tool called "${name}". Available: list_folder, search_files, read_text_file, read_pdf, file_info, propose_changes.`, label: 'Tried an unknown tool' }
      }
    } catch (e) {
      return { text: `Error: ${(e as Error).message}`, label: `A tool failed (${name})` }
    }
  }

  private async list(a: Record<string, unknown>): Promise<ToolOutcome> {
    const path = absPath(a['path'])
    if (!path) return { text: 'Error: path must be an absolute path', label: 'Bad folder path' }
    const r = await this.d.listDir(path)
    const label = `Looked in ${baseName(path) || path}`
    if ('error' in r) return { text: `Error: ${r.error}`, label }
    const sorted = [...r].sort((x, y) => Number(y.isDir) - Number(x.isDir) || x.name.localeCompare(y.name, undefined, { sensitivity: 'base' }))
    const shown = sorted.slice(0, LIST_MAX)
    const lines = shown.map((e) => (e.isDir ? `[folder] ${e.name}` : `${e.name} | ${size(e.size)} | ${day(e.mtimeMs)}`))
    const more = sorted.length > shown.length ? `\n... and ${sorted.length - shown.length} more (not shown)` : ''
    return { text: `${path} has ${sorted.length} items:\n${lines.join('\n')}${more}`, label }
  }

  private async search(a: Record<string, unknown>): Promise<ToolOutcome> {
    const root = absPath(a['root'])
    const query = typeof a['query'] === 'string' ? a['query'].trim() : ''
    if (!root || !query) return { text: 'Error: root (absolute path) and query are required', label: 'Bad search' }
    const r = await this.d.search(root, query, SEARCH_MAX)
    const label = `Searched “${query.slice(0, 40)}” in ${baseName(root) || root}`
    if ('error' in r) return { text: `Error: ${r.error}`, label }
    if (r.results.length === 0) return { text: `No file or folder under ${root} has all of: ${query}`, label }
    const lines = r.results.map((e) => `${e.isDir ? '[folder] ' : ''}${e.path}${e.isDir ? '' : ` | ${size(e.size)}`}`)
    return { text: `${r.results.length}${r.limited ? '+' : ''} matches:\n${lines.join('\n')}`, label }
  }

  private async readText(a: Record<string, unknown>): Promise<ToolOutcome> {
    const path = absPath(a['path'])
    if (!path) return { text: 'Error: path must be an absolute path', label: 'Bad file path' }
    const name = baseName(path)
    if (isSecretPath(path)) return { text: 'Error: this looks like a key or password file, so ORBIT does not show it to the AI.', label: `Skipped ${name} (private)` }
    const r = await this.d.readText(path)
    if (r.kind === 'binary') return { text: 'This is a binary file, not text. Use file_info, or read_pdf for PDFs.', label: `Looked at ${name}` }
    if (r.kind === 'error') return { text: `Error: ${r.message}`, label: `Couldn't read ${name}` }
    const cut = r.text.length > READ_CHARS
    return { text: `${r.text.slice(0, READ_CHARS)}${cut || r.truncated ? '\n[...file continues, not shown]' : ''}`, label: `Read ${name}` }
  }

  private async readPdf(a: Record<string, unknown>): Promise<ToolOutcome> {
    const path = absPath(a['path'])
    if (!path) return { text: 'Error: path must be an absolute path', label: 'Bad file path' }
    const name = baseName(path)
    if (isSecretPath(path)) return { text: 'Error: private file', label: `Skipped ${name} (private)` }
    const from = Number.isFinite(Number(a['from_page'])) && a['from_page'] !== undefined ? Number(a['from_page']) : 1
    const to = Number.isFinite(Number(a['to_page'])) && a['to_page'] !== undefined ? Number(a['to_page']) : from + 2
    const r = await this.d.readPdf(path, from, to)
    if ('error' in r) return { text: `Error: ${r.error}`, label: `Couldn't read ${name}` }
    const range = r.from === r.to ? `page ${r.from}` : `pages ${r.from}–${r.to}`
    const note = r.truncated ? `\n[Cut short to fit. Ask for fewer pages at a time.]` : r.to < r.pages ? `\n[This PDF has ${r.pages} pages. Call read_pdf again for more.]` : ''
    return { text: `${name}: ${r.pages} pages in total.\n${r.text}${note}`, label: `Read ${name}, ${range}` }
  }

  private async info(a: Record<string, unknown>): Promise<ToolOutcome> {
    const path = absPath(a['path'])
    if (!path) return { text: 'Error: path must be an absolute path', label: 'Bad path' }
    const e = await this.d.stat(path)
    const name = baseName(path)
    if (!e) return { text: `Error: ${path} does not exist`, label: `Checked ${name}` }
    return { text: `${e.isDir ? 'Folder' : 'File'} ${path}${e.isDir ? '' : ` | ${size(e.size)}`} | modified ${day(e.mtimeMs)}`, label: `Checked ${name}` }
  }

  private async propose(a: Record<string, unknown>): Promise<ToolOutcome> {
    const r = await this.d.validatePlan(a)
    if (!r.ok) return { text: `The plan was rejected, nothing was shown to the person. ${r.error} Fix it and call propose_changes again.`, label: 'Revised a plan' }
    this.plan = r.plan
    return { text: `The plan "${r.plan.title}" with ${r.plan.actions.length} action(s) is now shown to the person for review. Do not repeat it in full; say briefly what it does and that they can press Apply.`, label: 'Prepared a plan' }
  }
}
