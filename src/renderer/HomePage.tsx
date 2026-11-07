import type { DriveInfo, DriveType, Place } from '@shared/types'
import { timeAgo, type Recent } from '@shared/recents'
import { formatSize } from './format'
import { Icon, type IconName } from './Icons'

interface Props {
  places: Place[]
  drives: DriveInfo[]
  recents: Recent[]
  onOpen: (path: string) => void
  onBin: () => void
  onCopilot: () => void
  onMonitor: () => void
}

const DRIVE_ICON: Record<DriveType, IconName> = {
  fixed: 'drive',
  removable: 'usb',
  network: 'network',
  optical: 'optical',
  unknown: 'drive'
}

const DRIVE_LABEL: Record<DriveType, string> = {
  fixed: 'Local disk',
  removable: 'Removable',
  network: 'Network',
  optical: 'Optical',
  unknown: 'Drive'
}

function greeting(hour: number): string {
  if (hour < 5) return 'Working late'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function HomePage({ places, drives, recents, onOpen, onBin, onCopilot, onMonitor }: Props): JSX.Element {
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="home">
      <section className="hero">
        <span className="logo-mark hero-logo" style={{ height: 76 }} role="img" aria-label="ORBIT logo" />
        <div className="hero-text">
          <h1>{greeting(new Date().getHours())}</h1>
          <p>{today}</p>
        </div>
        <div className="hero-actions">
          <button className="hero-btn" onClick={onCopilot} title="Open the Copilot (Ctrl+J)">
            <Icon name="sparkle" size={16} />
            <span>Ask the Copilot</span>
            <kbd>Ctrl+J</kbd>
          </button>
          <button className="hero-btn quiet" onClick={onMonitor} title="Live CPU, memory, disk and network">
            <Icon name="monitor" size={16} />
            <span>System Monitor</span>
          </button>
        </div>
      </section>

      <h3>Quick access</h3>
      <div className="cards stagger">
        {places.map((p) => (
          <button key={p.path} className="card place" onClick={() => onOpen(p.path)} title={p.path}>
            <span className="badge">
              <Icon name={p.icon} size={22} />
            </span>
            <span className="card-title">{p.name}</span>
          </button>
        ))}
        <button className="card place" onClick={onBin} title="Recycle Bin">
          <span className="badge">
            <Icon name="trash" size={22} />
          </span>
          <span className="card-title">Recycle Bin</span>
        </button>
      </div>

      <h3>Drives</h3>
      <div className="cards wide stagger">
        {drives.length === 0 && <div className="hint">Reading drives…</div>}
        {drives.map((d) => {
          const pct = d.total > 0 ? (d.total - d.free) / d.total : 0
          return (
            <button key={d.path} className="card drivecard" onClick={() => onOpen(d.path)} title={d.path}>
              <span className="badge">
                <Icon name={DRIVE_ICON[d.type]} size={22} />
              </span>
              <span className="card-body">
                <span className="card-title">{d.name}</span>
                <span className="track">
                  <span className={`fill${pct > 0.9 ? ' full' : ''}`} style={{ width: `${Math.round(pct * 100)}%` }} />
                </span>
                <span className="card-sub">
                  {formatSize(d.free)} free of {formatSize(d.total)} · {DRIVE_LABEL[d.type]}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <h3>Recent folders</h3>
      {recents.length === 0 ? (
        <div className="hint">Folders you open will show up here.</div>
      ) : (
        <div className="recents">
          {recents.map((r) => (
            <button key={r.path} className="recent" onClick={() => onOpen(r.path)} title={r.path}>
              <Icon name="folder" className="ic dir" />
              <span className="recent-name">{r.name}</span>
              <span className="recent-path">{r.path}</span>
              <span className="recent-time">{timeAgo(r.ts)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
