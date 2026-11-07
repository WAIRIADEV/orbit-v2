import { useState } from 'react'
import type { FileKind } from '@shared/fileKind'
import { mediaUrl, thumbUrl } from '@shared/mediaUrl'
import type { FileEntry } from '@shared/types'
import { Icon } from './Icons'
import { KIND_ICON } from './fileIcon'

/** Kinds worth asking the main process for a thumbnail. Everything else just shows its icon. */
const THUMB_KINDS: ReadonlySet<FileKind> = new Set<FileKind>(['image', 'video', 'pdf'])

export function wantsThumb(kind: FileKind): boolean {
  return THUMB_KINDS.has(kind)
}

interface Props {
  entry: FileEntry
  kind: FileKind
}

/**
 * Icon tile content. The <img> exists only while the tile is mounted (the list is virtualized), so
 * scrolling away aborts the request and queued thumbnails for tiles no longer visible are skipped.
 * If no thumbnail can be made the icon stays.
 */
export function Thumb({ entry, kind }: Props): JSX.Element {
  const [failed, setFailed] = useState<string | null>(null)
  const icon = <Icon name={KIND_ICON[kind]} size={42} className={`ic k-${kind}`} />
  if (!wantsThumb(kind) || failed === entry.path) return <span className="thumb-box">{icon}</span>

  // SVGs are drawn by the browser itself: sharper than a raster thumbnail and no round trip.
  const isSvg = /\.svg$/i.test(entry.name)
  const src = isSvg ? mediaUrl(entry.path) : thumbUrl(entry.path, entry.mtimeMs)
  return (
    <span className="thumb-box has-img">
      <img
        key={entry.path}
        src={src}
        alt=""
        decoding="async"
        draggable={false}
        onError={() => setFailed(entry.path)}
      />
    </span>
  )
}
