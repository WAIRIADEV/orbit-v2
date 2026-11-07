import { useEffect, useRef, useState } from 'react'
import type { DriveInfo, PerfSample, SensorReading, SysSample } from '@shared/types'
import { Icon } from './Icons'
import { formatSize } from './format'

const HISTORY = 120 // seconds of history, one sample per second

interface Props {
  drives: DriveInfo[]
  onClose: () => void
}

const GB = 1024 ** 3

function stats(xs: number[]): { min: number; avg: number; max: number } {
  if (xs.length === 0) return { min: 0, avg: 0, max: 0 }
  let min = Infinity
  let max = -Infinity
  let sum = 0
  for (const x of xs) {
    if (x < min) min = x
    if (x > max) max = x
    sum += x
  }
  return { min, avg: sum / xs.length, max }
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** A 270-degree ring gauge, 0-100. */
function Gauge({ value, label, tone, text }: { value: number; label: string; tone: string; text?: string }): JSX.Element {
  const r = 46
  const arc = 2 * Math.PI * r * 0.75
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className="gauge" role="img" aria-label={`${label} ${Math.round(v)}%`}>
      <svg viewBox="0 0 120 120">
        <circle className="g-track" cx="60" cy="60" r={r} strokeDasharray={`${arc} 999`} transform="rotate(135 60 60)" />
        <circle
          className={`g-fill ${tone}`}
          cx="60"
          cy="60"
          r={r}
          strokeDasharray={`${(arc * v) / 100} 999`}
          transform="rotate(135 60 60)"
        />
      </svg>
      <div className="g-text">
        <b>{text ?? `${Math.round(v)}%`}</b>
        <span>{label}</span>
      </div>
    </div>
  )
}

/** Filled line chart of the last HISTORY values (0-100). Pure SVG: one path per series, redrawn once a second. */
function AreaChart({ values, tone }: { values: number[]; tone: string }): JSX.Element {
  const W = 240
  const H = 60
  const step = W / (HISTORY - 1)
  const offset = (HISTORY - values.length) * step // newest on the right, history grows in from the left
  const pts = values.map((v, i) => `${(offset + i * step).toFixed(1)},${(H - (Math.max(0, Math.min(100, v)) / 100) * H).toFixed(1)}`)
  const line = pts.length > 0 ? `M${pts.join(' L')}` : ''
  const area = pts.length > 0 ? `${line} L${W},${H} L${offset.toFixed(1)},${H} Z` : ''
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {[25, 50, 75].map((g) => (
        <line key={g} className="grid" x1="0" x2={W} y1={H - (g / 100) * H} y2={H - (g / 100) * H} />
      ))}
      <path className={`area ${tone}`} d={area} />
      <path className={`line ${tone}`} d={line} />
    </svg>
  )
}

function Tile({ label, value, foot }: { label: string; value: string; foot?: string }): JSX.Element {
  return (
    <div className="mtile">
      <span className="mt-label">{label}</span>
      <b className="mt-value">{value}</b>
      {foot && <span className="mt-foot">{foot}</span>}
    </div>
  )
}

export function Monitor({ drives, onClose }: Props): JSX.Element {
  const [now, setNow] = useState<SysSample | null>(null)
  const [orbit, setOrbit] = useState<PerfSample | null>(null)
  const [sensors, setSensors] = useState<SensorReading | null>(null)
  const [failed, setFailed] = useState(false)
  const cpuHist = useRef<number[]>([])
  const memHist = useRef<number[]>([])
  const ticks = useRef(0)

  useEffect(() => {
    let alive = true
    const tick = async (): Promise<void> => {
      if (document.hidden) return
      try {
        const s = await window.orbit.sysSample()
        if (!alive) return
        cpuHist.current = [...cpuHist.current, s.cpu].slice(-HISTORY)
        memHist.current = [...memHist.current, s.memTotal > 0 ? (s.memUsed / s.memTotal) * 100 : 0].slice(-HISTORY)
        setNow(s)
        if (ticks.current++ % 2 === 0) setOrbit(await window.orbit.perf())
        try {
          const sr = await window.orbit.sensors()
          if (alive) setSensors(sr)
        } catch {
          /* sensors are optional: the rest of the page keeps working */
        }
      } catch {
        if (alive) setFailed(true)
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 1000)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      alive = false
      window.clearInterval(timer)
      window.removeEventListener('keydown', onKey)
      window.orbit.sensorsStop() // stops the typeperf readers: nothing runs while the page is closed
    }
  }, [onClose])

  const cpu = stats(cpuHist.current)
  const mem = stats(memHist.current)
  const memPct = now && now.memTotal > 0 ? (now.memUsed / now.memTotal) * 100 : 0
  const tone = (v: number): string => (v < 60 ? 'ok' : v < 85 ? 'warn' : 'bad')
  const rate = (bps: number | null): string => (bps === null ? 'N/A' : `${formatSize(bps)}/s`)
  const why = (group: 'basic' | 'thermal' | 'gpu' | 'vram'): string => {
    if (!sensors) return 'Reading…'
    const st = sensors.status[group]
    if (st === 'starting') return 'Reading…'
    if (st === 'ok') return 'No value from this PC'
    const note = sensors.notes?.[group]?.join(' ')
    if (note && /no valid counters|not found|cannot find/i.test(note)) return 'No such counter on this PC'
    return note ?? 'Not provided by this PC'
  }
  const temp = sensors?.tempC ?? null

  return (
    <div className="monitor" role="region" aria-label="System monitor">
      <header className="mon-head">
        <Icon name="monitor" size={18} />
        <h2>System Monitor</h2>
        <span className="mon-sub">{now ? `Up ${formatUptime(now.uptimeSec)}` : ''}</span>
        <button className="iconbtn small" onClick={onClose} title="Close (Esc)" aria-label="Close">
          <Icon name="close" size={16} />
        </button>
      </header>

      {failed && <div className="error">Couldn't read system information.</div>}
      {!now && !failed && <div className="mon-note">Reading system information…</div>}

      {now && (
        <div className="mon-grid">
          <section className="mcard">
            <div className="mc-head">
              <h3>Processor</h3>
              <span>{now.cpuModel}</span>
            </div>
            <div className="mc-body">
              <Gauge value={now.cpu} label="LOAD" tone={tone(now.cpu)} />
              {temp !== null && <Gauge value={temp} label="TEMP" tone={temp < 70 ? 'ok' : temp < 85 ? 'warn' : 'bad'} text={`${Math.round(temp)}°C`} />}
              <div className="mtiles">
                <Tile label="Load" value={`${now.cpu.toFixed(1)}%`} foot={`Min ${cpu.min.toFixed(0)}% · Avg ${cpu.avg.toFixed(0)}% · Max ${cpu.max.toFixed(0)}%`} />
                <Tile
                  label="Clock"
                  value={
                    sensors?.cpuMHz
                      ? `${sensors.cpuMHz} MHz`
                      : sensors?.cpuNominalMHz
                        ? `${sensors.cpuNominalMHz} MHz`
                        : now.baseMHz > 0
                          ? `${now.baseMHz} MHz`
                          : 'N/A'
                  }
                  foot={
                    sensors?.cpuMHz
                      ? `Live · base ${sensors.cpuNominalMHz ?? now.baseMHz} MHz`
                      : sensors?.cpuPerfPct != null
                        ? `Base clock · live reading (${sensors.cpuPerfPct}% of base) looked wrong`
                        : 'Base clock (live speed unavailable)'
                  }
                />
                <Tile label="Logical cores" value={String(now.cores.length)} />
              </div>
            </div>
            <AreaChart values={cpuHist.current} tone="cpu" />
            <div className="cores" style={{ gridTemplateColumns: `repeat(${Math.min(8, Math.max(1, now.cores.length))}, 1fr)` }}>
              {now.cores.map((c, i) => (
                <div className="core" key={i} title={`Core ${i}: ${c}%`}>
                  <span>
                    C{i} {Math.round(c)}%
                  </span>
                  <i style={{ width: `${c}%` }} className={tone(c)} />
                </div>
              ))}
            </div>
          </section>

          <section className="mcard">
            <div className="mc-head">
              <h3>Memory</h3>
              <span>
                <b>
                  {(now.memUsed / GB).toFixed(1)} / {(now.memTotal / GB).toFixed(1)} GB
                </b>{' '}
                <em className={tone(memPct)}>{Math.round(memPct)} %</em>
              </span>
            </div>
            <div className="bar">
              <i style={{ width: `${memPct}%` }} className={tone(memPct)} />
            </div>
            <div className="mtiles three">
              <Tile label="In use" value={`${(now.memUsed / GB).toFixed(1)} GB`} foot={`Min ${mem.min.toFixed(0)}% · Avg ${mem.avg.toFixed(0)}% · Max ${mem.max.toFixed(0)}%`} />
              <Tile label="Available" value={`${((now.memTotal - now.memUsed) / GB).toFixed(1)} GB`} />
              <Tile label="Installed" value={`${(now.memTotal / GB).toFixed(1)} GB`} />
            </div>
            <AreaChart values={memHist.current} tone="mem" />
          </section>

          <section className="mcard">
            <div className="mc-head">
              <h3>Graphics &amp; I/O</h3>
              <span>from Windows performance counters</span>
            </div>
            <div className="mtiles three">
              <Tile label="GPU load" value={sensors?.gpuPct != null ? `${sensors.gpuPct}%` : 'N/A'} foot={sensors?.gpuPct != null ? 'Busiest engine' : why('gpu')} />
              <Tile label="GPU memory" value={sensors?.vramMB != null ? (sensors.vramMB >= 1024 ? `${(sensors.vramMB / 1024).toFixed(1)} GB` : `${sensors.vramMB} MB`) : 'N/A'} foot={sensors?.vramMB != null ? (sensors.vramShared ? 'Shared system memory, in use' : 'Dedicated, in use') : why('vram')} />
              <Tile label="CPU temp" value={temp !== null ? `${temp.toFixed(0)}°C` : 'N/A'} foot={temp !== null ? (sensors?.tempSource === 'acpi' ? 'ACPI zone (may not be the CPU core)' : 'Hottest thermal zone') : why('thermal')} />
              <Tile label="Disk busy" value={sensors?.diskBusyPct != null ? `${sensors.diskBusyPct}%` : 'N/A'} foot={sensors?.diskBusyPct != null ? `R ${rate(sensors.diskReadBps)} · W ${rate(sensors.diskWriteBps)}` : why('basic')} />
              <Tile label="Network ↓" value={rate(sensors?.netRxBps ?? null)} foot={sensors?.netRxBps != null ? 'All adapters' : why('basic')} />
              <Tile label="Network ↑" value={rate(sensors?.netTxBps ?? null)} foot={sensors?.netTxBps != null ? 'All adapters' : why('basic')} />
            </div>
            <p className="mon-hint">Fan speed, voltage, current and power need a hardware driver or vendor tool, so they are not shown.</p>
          </section>

          <section className="mcard">
            <div className="mc-head">
              <h3>Storage</h3>
              <span>{drives.length} {drives.length === 1 ? 'drive' : 'drives'}</span>
            </div>
            {drives.length === 0 && <div className="mon-note">No drives found</div>}
            {drives.map((d) => {
              const used = d.total > 0 ? ((d.total - d.free) / d.total) * 100 : 0
              return (
                <div className="drive-row" key={d.path}>
                  <div className="dr-top">
                    <span>{d.name}</span>
                    <span>
                      {formatSize(d.free)} free of {formatSize(d.total)}
                    </span>
                  </div>
                  <div className="bar">
                    <i style={{ width: `${used}%` }} className={used < 80 ? 'ok' : used < 92 ? 'warn' : 'bad'} />
                  </div>
                </div>
              )
            })}
          </section>

          <section className="mcard">
            <div className="mc-head">
              <h3>ORBIT</h3>
              <span>this app</span>
            </div>
            <div className="mtiles three">
              <Tile label="CPU" value={orbit ? `${orbit.cpu.toFixed(1)}%` : '…'} />
              <Tile label="Memory" value={orbit ? (orbit.memMB >= 1024 ? `${(orbit.memMB / 1024).toFixed(1)} GB` : `${orbit.memMB} MB`) : '…'} />
              <Tile label="Processes" value={orbit ? String(orbit.processes) : '…'} />
            </div>
            {orbit?.parts.map((p) => (
              <div className="part-row" key={p.name}>
                <span>
                  {p.name}
                  {p.count > 1 ? ` ×${p.count}` : ''}
                </span>
                <span>
                  {p.cpu}% · {p.memMB >= 1024 ? `${(p.memMB / 1024).toFixed(1)} GB` : `${p.memMB} MB`}
                </span>
              </div>
            ))}
          </section>

        </div>
      )}
    </div>
  )
}
