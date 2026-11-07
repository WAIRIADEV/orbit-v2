import { useEffect, useState } from 'react'
import { extensionOf, fileKind, type FileKind } from '@shared/fileKind'
import { mediaUrl } from '@shared/mediaUrl'
import { parentPath } from '@shared/paths'
import type { FileEntry, TextPreview } from '@shared/types'
import { Icon } from './Icons'
import { KIND_ICON, KIND_LABEL } from './fileIcon'
import { formatSize } from './format'

interface Props {
  entry: FileEntry | null
  onClose: () => void
  onOpen: (entry: FileEntry) => void
  /** Opens a PDF in ORBIT's reader. */
  onRead: (entry: FileEntry) => void
}

// Kinds we try to read as text. Archives, audio etc. are known binary, so we skip the attempt.
const TEXT_KINDS: FileKind[] = ['code', 'document', 'file']

type TextState = { path: string; result: TextPreview } | null

export function QuickLook({ entry, onClose, onOpen, onRead }: Props): JSX.Element {
  const kind = entry ? fileKind(entry.name, entry.isDir) : null
  const wantsText = !!entry && !!kind && TEXT_KINDS.includes(kind)
  const [text, setText] = useState<TextState>(null)
  const [mediaFailed, setMediaFailed] = useState<string | null>(null)

  // Load the text of the focused file. While you arrow through a folder only the latest request wins.
  useEffect(() => {
    if (!entry || !wantsText) return
    let cancelled = false
    void window.orbit.previewText(entry.path).then((result) => {
      if (!cancelled) setText({ path: entry.path, result })
    })
    return () => {
      cancelled = true
    }
  }, [entry, wantsText])

  const preview = (): JSX.Element => {
    if (!entry || !kind) return <div className="ql-empty">Select a file to preview it</div>
    const src = mediaUrl(entry.path)

    if (mediaFailed === entry.path) return <NoPreview kind={kind} note="This file could not be shown." />

    switch (kind) {
      case 'folder':
        return <NoPreview kind={kind} />
      case 'image':
        return (
          <div className="ql-media">
            <img key={entry.path} src={src} alt={entry.name} onError={() => setMediaFailed(entry.path)} />
          </div>
        )
      case 'video':
        return (
          <div className="ql-media">
            <video key={entry.path} src={src} controls preload="metadata" onError={() => setMediaFailed(entry.path)} />
          </div>
        )
      case 'audio':
        return (
          <div className="ql-audio">
            <Icon name="music" size={56} className="ic k-audio" />
            <audio key={entry.path} src={src} controls preload="metadata" onError={() => setMediaFailed(entry.path)} />
          </div>
        )
      case 'pdf':
        return <iframe key={entry.path} className="ql-pdf" src={src} title={entry.name} />
      default: {
        if (!wantsText) return <NoPreview kind={kind} />
        if (!text || text.path !== entry.path) return <div className="ql-empty">Loading…</div>
        const r = text.result
        if (r.kind === 'binary') return <NoPreview kind={kind} note="No preview for this type of file." />
        if (r.kind === 'error') return <NoPreview kind={kind} note={r.message} />
        return (
          <div className="ql-text">
            <pre>{r.text || '(empty file)'}</pre>
            {r.truncated && <div className="ql-trunc">Showing the first 64 KB</div>}
          </div>
        )
      }
    }
  }

  return (
    <aside className="quicklook" aria-label="Quick Look">
      <div className="ql-head">
        <Icon name={kind ? KIND_ICON[kind] : 'file'} size={20} className={`ic k-${kind ?? 'file'}`} />
        <div className="ql-title" title={entry?.name}>
          {entry ? entry.name : 'Quick Look'}
        </div>
        {entry && kind === 'pdf' && (
          <button className="ql-open" onClick={() => onRead(entry)} title="Read in ORBIT (search, zoom, select text)">
            Read
          </button>
        )}
        {entry && !entry.isDir && (
          <button className="ql-open" onClick={() => onOpen(entry)} title="Open in the default app (Enter)">
            Open
          </button>
        )}
        <button className="iconbtn small" onClick={onClose} title="Close (Space or Esc)">
          <Icon name="close" size={15} />
        </button>
      </div>

      <div className="ql-body">{preview()}</div>

      {entry && kind && (
        <dl className="ql-meta">
          <dt>Type</dt>
          <dd>
            {KIND_LABEL[kind]}
            {!entry.isDir && extensionOf(entry.name) ? ` · ${extensionOf(entry.name).toUpperCase()}` : ''}
          </dd>
          {!entry.isDir && (
            <>
              <dt>Size</dt>
              <dd>
                {formatSize(entry.size)} <span className="muted">({entry.size.toLocaleString()} bytes)</span>
              </dd>
            </>
          )}
          <dt>Modified</dt>
          <dd>{entry.mtimeMs ? new Date(entry.mtimeMs).toLocaleString() : '—'}</dd>
          <dt>Location</dt>
          <dd className="wrap">{parentPath(entry.path)}</dd>
        </dl>
      )}
    </aside>
  )
}

function NoPreview({ kind, note }: { kind: FileKind; note?: string }): JSX.Element {
  return (
    <div className="ql-none">
      <Icon name={KIND_ICON[kind]} size={64} className={`ic k-${kind}`} />
      {note && <p>{note}</p>}
    </div>
  )
}
