import { useEffect, useRef, useState } from 'react'
import { ACCENTS, findAccent } from '@shared/accents'
import type { ThemeMode } from '@shared/types'
import { Icon } from './Icons'

interface Props {
  theme: ThemeMode
  onToggleTheme: () => void
  accent: string
  onAccent: (id: string) => void
  dual: boolean
  onToggleDual: () => void
}

/** The window's own title bar: drag area plus the app-wide switches. */
export function TitleBar({ theme, onToggleTheme, accent, onAccent, dual, onToggleDual }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  // Close the colour popover on outside click or Escape.
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent): void => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  const current = findAccent(accent)

  return (
    <header className="titlebar">
      <div className="brand">
        <span className="logo-mark" style={{ height: 21 }} role="img" aria-label="ORBIT logo" />
        <span>ORBIT</span>
      </div>

      <div className="spacer" />

      <button
        className={`iconbtn${dual ? ' on' : ''}`}
        onClick={onToggleDual}
        aria-pressed={dual}
        title={dual ? 'Single pane' : 'Dual pane'}
      >
        <Icon name="dual" size={17} />
      </button>

      <div className="popwrap" ref={wrap}>
        <button className="iconbtn" onClick={() => setOpen((o) => !o)} title="Accent colour" aria-expanded={open}>
          <Icon name="palette" size={17} />
        </button>
        {open && (
          <div className="popover" role="dialog" aria-label="Accent colour">
            <div className="pop-title">Accent colour</div>
            <div className="swatches">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  className={`swatch${a.id === current.id ? ' on' : ''}`}
                  style={{ background: theme === 'dark' ? a.dark : a.light }}
                  title={a.label}
                  aria-label={a.label}
                  aria-pressed={a.id === current.id}
                  onClick={() => onAccent(a.id)}
                >
                  {a.id === current.id && <Icon name="check" size={14} />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <button
        className="iconbtn"
        onClick={onToggleTheme}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
      </button>
    </header>
  )
}
