import { useEffect, useRef, useState } from 'react'
import type { PerfSample } from '@shared/types'

export interface StatusInfo {
  /** Left side: "51 items · 3 selected". */
  summary: string
  /** Middle: operation progress or the last message. */
  note: string | null
  noteIsError: boolean
  onCancelOp: (() => void) | null
  onStopSearch: (() => void) | null
  /** Folder-open time of the active pane, or null while it is still listing. */
  listMs: number | null
  pane: string | null
}

/** Live FPS from requestAnimationFrame, in its own component so only the meter re-renders. */
function Fps(): JSX.Element {
  const [fps, setFps] = useState(0)
  const frames = useRef(0)
  const last = useRef(performance.now())

  useEffect(() => {
    let raf = 0
    const tick = (now: number): void => {
      frames.current++
      if (now - last.current >= 500) {
        setFps(Math.round((frames.current * 1000) / (now - last.current)))
        frames.current = 0
        last.current = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const cls = fps >= 55 ? 'ok' : fps >= 30 ? 'warn' : 'bad'
  return (
    <span className={`stat ${cls}`} title="Frames per second">
      <b>{fps}</b> fps
    </span>
  )
}

export function formatMem(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`
}

/** ORBIT's own CPU and memory. Polls every 2 s, and not at all while the window is hidden. */
function PerfMeter(): JSX.Element | null {
  const [s, setS] = useState<PerfSample | null>(null)

  useEffect(() => {
    let alive = true
    const tick = async (): Promise<void> => {
      if (document.hidden) return
      try {
        const next = await window.orbit.perf()
        if (alive) setS(next)
      } catch {
        /* the meter is optional: never let it break the status bar */
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 2000)
    const onVisible = (): void => {
      if (!document.hidden) void tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (!s) return null
  const cpuClass = s.cpu < 25 ? 'ok' : s.cpu < 60 ? 'warn' : 'bad'
  const memClass = s.memMB < 600 ? 'ok' : s.memMB < 1200 ? 'warn' : 'bad'
  const detail = s.parts.map((p) => `${p.name}${p.count > 1 ? ` ×${p.count}` : ''}: ${p.cpu}% · ${formatMem(p.memMB)}`).join('\n')
  return (
    <>
      <span className={`stat ${cpuClass}`} title={`ORBIT's CPU use (share of the whole machine)\n${detail}`}>
        <b>{s.cpu < 10 ? s.cpu.toFixed(1) : Math.round(s.cpu)}%</b> CPU
      </span>
      <span className={`stat ${memClass}`} title={`ORBIT's memory, ${s.processes} processes\n${detail}`}>
        <b>{formatMem(s.memMB)}</b>
      </span>
    </>
  )
}

export function StatusBar(s: StatusInfo): JSX.Element {
  const msClass = s.listMs === null ? '' : s.listMs <= 100 ? 'ok' : s.listMs <= 400 ? 'warn' : 'bad'
  return (
    <footer className="status">
      <span className="status-left">{s.summary}</span>

      <span className={`status-note${s.noteIsError ? ' bad' : ''}`}>{s.note}</span>
      {s.onCancelOp && (
        <button className="link" onClick={s.onCancelOp}>
          cancel
        </button>
      )}
      {s.onStopSearch && (
        <button className="link" onClick={s.onStopSearch}>
          stop search
        </button>
      )}

      <div className="status-meter">
        {s.pane && <span className="stat">{s.pane}</span>}
        <span className={`stat ${msClass}`} title="Time to open the current folder">
          <b>{s.listMs === null ? '…' : s.listMs}</b> ms
        </span>
        <PerfMeter />
        <Fps />
      </div>
    </footer>
  )
}
