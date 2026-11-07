import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { breadcrumbs } from '@shared/paths'
import { Icon } from './Icons'

export interface DeepStatus {
  running: boolean
  count: number
  limited: boolean
}

interface Props {
  path: string | null
  bin: boolean
  onUp: () => void
  onHome: () => void
  onNavigate: (path: string) => void
  query: string
  onQuery: (q: string) => void
  onDeepSearch: () => void
  onEscape: () => void
  onArrowDown: () => void
  inputRef: RefObject<HTMLInputElement>
  deep: DeepStatus | null
}

/** Up button, clickable path and search box. Every pane has its own. */
export function PaneBar(p: Props): JSX.Element {
  const crumbs = p.path ? breadcrumbs(p.path) : []
  const atHome = p.path === null && !p.bin
  const noSearch = p.path === null

  // A long path is clipped from the left (the end stays readable); fade that edge instead of cutting a word in half.
  const navRef = useRef<HTMLElement>(null)
  const [clipped, setClipped] = useState(false)
  useLayoutEffect(() => {
    const el = navRef.current
    if (!el) return
    const check = (): void => {
      const first = el.firstElementChild
      setClipped(!!first && first.getBoundingClientRect().left < el.getBoundingClientRect().left - 1)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [p.path, p.bin])

  return (
    <div className="panebar">
      <button className="iconbtn" disabled={atHome} onClick={p.onUp} title="Up one folder (Backspace)">
        <Icon name="up" size={16} />
      </button>

      <nav ref={navRef} className={`crumbs${clipped ? ' clipped' : ''}`} aria-label="Path">
        <button className={`crumb homecrumb${atHome ? ' here' : ''}`} onClick={p.onHome}>
          <Icon name="orbit" size={15} />
          Home
        </button>
        {crumbs.map((c) => (
          <span className="crumb-wrap" key={c.path}>
            <Icon name="chevron" size={12} className="sep" />
            <button className="crumb" onClick={() => p.onNavigate(c.path)}>
              {c.label}
            </button>
          </span>
        ))}
        {p.bin && (
          <span className="crumb-wrap">
            <Icon name="chevron" size={12} className="sep" />
            <button className="crumb here">Recycle Bin</button>
          </span>
        )}
      </nav>

      <div className={`search${noSearch ? ' off' : ''}`}>
        <Icon name="search" size={15} />
        <input
          ref={p.inputRef}
          value={p.query}
          disabled={noSearch}
          placeholder={noSearch ? 'Open a folder to search' : 'Search  ·  Enter: subfolders'}
          spellCheck={false}
          onChange={(e) => p.onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') p.onDeepSearch()
            else if (e.key === 'Escape') p.onEscape()
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              p.onArrowDown()
            }
          }}
        />
        {p.deep && (
          <span className="search-state">
            {p.deep.running
              ? `${p.deep.count.toLocaleString()}…`
              : `${p.deep.count.toLocaleString()}${p.deep.limited ? '+' : ''} found`}
          </span>
        )}
        {p.query && (
          <button className="clear" onClick={p.onEscape} title="Clear (Esc)">
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
