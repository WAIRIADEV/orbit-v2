import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './Icons'

export interface RowButton {
  icon: IconName
  label: string
  shortcut?: string
  disabled?: boolean
  onSelect: () => void
}

export type MenuEntry =
  | { type: 'row'; buttons: RowButton[] }
  | { type: 'item'; label: string; icon?: IconName; shortcut?: string; disabled?: boolean; bold?: boolean; checked?: boolean; onSelect: () => void }
  | { type: 'sub'; label: string; icon?: IconName; disabled?: boolean; items: MenuEntry[] }
  | { type: 'sep' }

interface Props {
  x: number
  y: number
  items: MenuEntry[]
  onClose: () => void
}

const MARGIN = 8

/**
 * A Windows 11 style menu: an icon row on top (Cut / Copy / Rename / Delete), then labelled items,
 * with one level of submenus. Keyboard: Up/Down, Right/Left for submenus, Enter, Esc. It closes on any
 * outside click, scroll, resize or when the window loses focus, and is kept inside the window.
 */
export function ContextMenu({ x, y, items, onClose }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [flip, setFlip] = useState(false) // submenus open to the left when there is no room on the right

  // Measure, then flip / clamp so the menu never runs off the window.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const nx = x + r.width + MARGIN > window.innerWidth ? Math.max(MARGIN, x - r.width) : x
    const ny = y + r.height + MARGIN > window.innerHeight ? Math.max(MARGIN, window.innerHeight - r.height - MARGIN) : y
    setPos({ x: nx, y: ny })
    setFlip(nx + r.width + 210 > window.innerWidth)
    el.focus()
  }, [x, y])

  useEffect(() => {
    const away = (e: Event): void => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      onClose()
    }
    const close = (): void => onClose()
    window.addEventListener('mousedown', away, true)
    window.addEventListener('contextmenu', away, true)
    window.addEventListener('wheel', close, { passive: true })
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', away, true)
      window.removeEventListener('contextmenu', away, true)
      window.removeEventListener('wheel', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
    }
  }, [onClose])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const root = ref.current
    if (!root) return
    const target = e.target as HTMLElement
    // Keys act on the menu that currently holds focus (the main one or an open submenu).
    const menu = target.closest<HTMLElement>('[role="menu"]') ?? root
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>(':scope > [role="menuitem"]:not(:disabled), :scope > .cm-row > [role="menuitem"]:not(:disabled), :scope > .cm-subwrap > [role="menuitem"]:not(:disabled)')]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        buttons[(i + 1) % buttons.length]?.focus()
        break
      case 'ArrowUp':
        e.preventDefault()
        buttons[(i - 1 + buttons.length) % buttons.length]?.focus()
        break
      case 'ArrowRight': {
        const cur = document.activeElement as HTMLElement | null
        if (cur?.dataset['sub'] === '1') {
          e.preventDefault()
          cur.parentElement?.querySelector<HTMLButtonElement>('.cm-submenu [role="menuitem"]:not(:disabled)')?.focus()
        } else if (cur?.closest('.cm-row')) {
          e.preventDefault()
          buttons[(i + 1) % buttons.length]?.focus()
        }
        break
      }
      case 'ArrowLeft': {
        const sub = target.closest('.cm-submenu')
        if (sub) {
          e.preventDefault()
          sub.parentElement?.querySelector<HTMLButtonElement>(':scope > [data-sub="1"]')?.focus()
        } else if (target.closest('.cm-row')) {
          e.preventDefault()
          buttons[(i - 1 + buttons.length) % buttons.length]?.focus()
        }
        break
      }
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        onClose()
        break
      case 'Tab':
        e.preventDefault()
        break
    }
  }

  // Keeps a submenu on screen: if it would run past the bottom edge, shift it up by the overflow.
  const fitSub = (e: React.SyntheticEvent<HTMLDivElement>): void => {
    const sub = e.currentTarget.querySelector<HTMLElement>(':scope > .cm-submenu')
    if (!sub) return
    sub.style.top = ''
    requestAnimationFrame(() => {
      const over = sub.getBoundingClientRect().bottom + MARGIN - window.innerHeight
      if (over > 0) sub.style.top = `${-7 - over}px`
    })
  }

  const run = (fn: () => void): void => {
    onClose()
    fn()
  }

  const render = (entries: MenuEntry[]): JSX.Element[] =>
    entries.map((en, k) => {
      if (en.type === 'sep') return <div key={k} className="cm-sep" role="separator" />
      if (en.type === 'row') {
        return (
          <div key={k} className="cm-row">
            {en.buttons.map((b) => (
              <button
                key={b.label}
                role="menuitem"
                className="cm-rowbtn"
                disabled={b.disabled}
                title={b.shortcut ? `${b.label} (${b.shortcut})` : b.label}
                aria-label={b.label}
                onClick={() => run(b.onSelect)}
              >
                <Icon name={b.icon} size={18} />
              </button>
            ))}
          </div>
        )
      }
      if (en.type === 'sub') {
        return (
          <div key={k} className="cm-subwrap" onMouseEnter={fitSub} onFocus={fitSub}>
            <button role="menuitem" aria-haspopup="menu" data-sub="1" className="cm-item" disabled={en.disabled}>
              <span className="cm-ic">{en.icon && <Icon name={en.icon} size={16} />}</span>
              <span className="cm-label">{en.label}</span>
              <Icon name="chevron" size={12} className="cm-more" />
            </button>
            <div className="cm-submenu" role="menu">
              {render(en.items)}
            </div>
          </div>
        )
      }
      return (
        <button
          key={k}
          role="menuitem"
          className={`cm-item${en.bold ? ' bold' : ''}`}
          disabled={en.disabled}
          onClick={() => run(en.onSelect)}
        >
          <span className="cm-ic">{en.checked ? <Icon name="check" size={15} /> : en.icon && <Icon name={en.icon} size={16} />}</span>
          <span className="cm-label">{en.label}</span>
          {en.shortcut && <span className="cm-key">{en.shortcut}</span>}
        </button>
      )
    })

  // Rendered in <body>: panes use container queries, which would trap position:fixed inside the pane.
  return createPortal(
    <div
      ref={ref}
      className={`cm${flip ? ' flip' : ''}`}
      role="menu"
      tabIndex={-1}
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {render(items)}
    </div>,
    document.body
  )
}
