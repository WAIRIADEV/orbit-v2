import type { DriveInfo, DriveType, Place } from '@shared/types'
import { formatSize } from './format'
import { Icon, type IconName } from './Icons'

interface Props {
  places: Place[]
  drives: DriveInfo[]
  current: string | null
  onOpen: (path: string) => void
  onHome: () => void
  onBin: () => void
  binActive: boolean
  monitorActive: boolean
  onMonitor: () => void
  aiActive: boolean
  onAi: () => void
}

const DRIVE_ICON: Record<DriveType, IconName> = {
  fixed: 'drive',
  removable: 'usb',
  network: 'network',
  optical: 'optical',
  unknown: 'drive'
}

export function Sidebar({ places, drives, current, onOpen, onHome, onBin, binActive, monitorActive, onMonitor, aiActive, onAi }: Props): JSX.Element {
  const cur = (current ?? '').toLowerCase()
  // A drive is highlighted only when no quick-access folder is the current one, so two rows never compete.
  const placeActive = places.some((p) => cur === p.path.toLowerCase())

  return (
    <aside className="sidebar">
      <button className={`item${current === null && !binActive ? ' active' : ''}`} onClick={onHome}>
        <Icon name="orbit" />
        <span>Home</span>
      </button>

      <h4>Quick access</h4>
      {places.map((p) => (
        <button
          key={p.path}
          className={`item${cur === p.path.toLowerCase() ? ' active' : ''}`}
          onClick={() => onOpen(p.path)}
        >
          <Icon name={p.icon} />
          <span>{p.name}</span>
        </button>
      ))}

      <button className={`item${binActive ? ' active' : ''}`} onClick={onBin}>
        <Icon name="trash" />
        <span>Recycle Bin</span>
      </button>

      <button className={`item${aiActive ? ' active' : ''}`} onClick={onAi} title="Copilot (Ctrl+J)">
        <Icon name="sparkle" />
        <span>Copilot</span>
      </button>

      <button className={`item${monitorActive ? ' active' : ''}`} onClick={onMonitor}>
        <Icon name="monitor" />
        <span>System Monitor</span>
      </button>

      <h4>Drives</h4>
      {drives.length === 0 && <div className="hint">Reading drives…</div>}
      {drives.map((d) => {
        const pct = d.total > 0 ? (d.total - d.free) / d.total : 0
        const active = !placeActive && cur !== '' && d.path.length > 1 && cur.startsWith(d.path.toLowerCase())
        return (
          <button
            key={d.path}
            className={`item drive${active ? ' active' : ''}`}
            onClick={() => onOpen(d.path)}
            title={`${d.path} · ${formatSize(d.free)} free of ${formatSize(d.total)}`}
          >
            <Icon name={DRIVE_ICON[d.type]} />
            <span className="drive-text">
              <span className="drive-name">{d.name}</span>
              <span className="track">
                <span className={`fill${pct > 0.9 ? ' full' : ''}`} style={{ width: `${Math.round(pct * 100)}%` }} />
              </span>
              <span className="drive-free">
                {formatSize(d.free)} free of {formatSize(d.total)}
              </span>
            </span>
          </button>
        )
      })}
    </aside>
  )
}
