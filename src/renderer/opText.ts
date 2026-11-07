import type { OpProgress } from '../shared/types.ts'

const leaf = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p

/** What the status bar says while an operation is queued or running. */
export function opActiveText(op: OpProgress): string {
  if (op.kind === 'zip' || op.kind === 'unzip') {
    const verb = op.kind === 'zip' ? 'Compressing' : 'Extracting'
    if (op.status === 'queued') return `${verb}… (waiting)`
    return `${verb} ${op.percent ?? 0}%${op.current ? ` · ${leaf(op.current)}` : ''}`
  }
  return `${op.kind} ${op.done}/${op.total}${op.current ? ` · ${op.current}` : ''}`
}

/** A message for when an operation ends, or null when the pane refresh is feedback enough. */
export function opDoneText(op: OpProgress): string | null {
  if (op.status === 'cancelled' && (op.kind === 'zip' || op.kind === 'unzip')) return op.kind === 'zip' ? 'Compression cancelled' : 'Extraction cancelled'
  if (op.status !== 'done' || !op.created) return null
  if (op.kind === 'zip') return `Created ${leaf(op.created)}`
  if (op.kind === 'unzip') return `Extracted to ${leaf(op.created)}`
  return null
}
