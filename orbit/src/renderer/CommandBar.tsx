import { Icon, type IconName } from './Icons'

interface Props {
  hasTarget: boolean
  canRename: boolean
  canPaste: boolean
  /** Creating things is not possible inside search results. */
  canCreate: boolean
  onNew: (x: number, y: number) => void
  onCut: () => void
  onCopy: () => void
  onPaste: () => void
  onRename: () => void
  onTrash: () => void
}

/** The Explorer-style command bar: New, then Cut / Copy / Paste / Rename / Delete as icons. */
export function CommandBar(p: Props): JSX.Element {
  const btn = (icon: IconName, label: string, key: string, enabled: boolean, onClick: () => void): JSX.Element => (
    <button className="cmdbtn" disabled={!enabled} title={`${label} (${key})`} aria-label={label} onClick={onClick}>
      <Icon name={icon} size={17} />
    </button>
  )
  return (
    <div className="cmdbar" role="toolbar" aria-label="Commands">
      <button
        className="cmdnew"
        disabled={!p.canCreate}
        title="New (Ctrl+Shift+N for a folder)"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          p.onNew(r.left, r.bottom + 4)
        }}
      >
        <Icon name="plus" size={16} />
        <span>New</span>
        <Icon name="chevron" size={11} className="cmd-caret" />
      </button>
      <span className="cmdsep" />
      {btn('cut', 'Cut', 'Ctrl+X', p.hasTarget, p.onCut)}
      {btn('copy', 'Copy', 'Ctrl+C', p.hasTarget, p.onCopy)}
      {btn('paste', 'Paste', 'Ctrl+V', p.canPaste, p.onPaste)}
      {btn('rename', 'Rename', 'F2', p.canRename, p.onRename)}
      {btn('trash', 'Delete', 'Del', p.hasTarget, p.onTrash)}
    </div>
  )
}
