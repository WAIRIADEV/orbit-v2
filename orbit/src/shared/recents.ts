export interface Recent {
  path: string
  name: string
  isDir: boolean
  /** Epoch ms when it was last opened. */
  ts: number
}

/** Newest first, no duplicates (case-insensitive paths, as on Windows), capped. */
export function pushRecent(list: Recent[], item: Recent, max = 12): Recent[] {
  const key = item.path.toLowerCase()
  return [item, ...list.filter((r) => r.path.toLowerCase() !== key)].slice(0, max)
}

export function timeAgo(ts: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 14) return `${d} days ago`
  return new Date(ts).toLocaleDateString()
}
