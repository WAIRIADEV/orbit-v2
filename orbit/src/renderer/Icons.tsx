export type IconName =
  | 'folder'
  | 'file'
  | 'home'
  | 'desktop'
  | 'documents'
  | 'downloads'
  | 'pictures'
  | 'music'
  | 'videos'
  | 'drive'
  | 'usb'
  | 'network'
  | 'optical'
  | 'search'
  | 'up'
  | 'close'
  | 'chevron'
  | 'sun'
  | 'moon'
  | 'details'
  | 'compact'
  | 'grid'
  | 'archive'
  | 'code'
  | 'orbit'
  | 'dual'
  | 'palette'
  | 'check'
  | 'trash'
  | 'monitor'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'rename'
  | 'refresh'
  | 'newfolder'
  | 'newfile'
  | 'open'
  | 'link'
  | 'undo'
  | 'eye'
  | 'selectall'
  | 'sort'
  | 'plus'
  | 'sparkle'

const SHAPES: Record<IconName, JSX.Element> = {
  monitor: (
    <>
      <path d="M3 13h4l2-6 4 11 2-5h6" />
    </>
  ),
  cut: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </>
  ),
  paste: (
    <>
      <rect x="6" y="5" width="12" height="16" rx="2" />
      <path d="M9 5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
    </>
  ),
  rename: <path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z" />,
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 5v6h-6" />
    </>
  ),
  newfolder: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M12 10.5v5M9.5 13h5" />
    </>
  ),
  newfile: (
    <>
      <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M12 11v6M9 14h6" />
    </>
  ),
  open: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  selectall: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </>
  ),
  sort: (
    <>
      <path d="M7 5v14M4 16l3 3 3-3" />
      <path d="M17 19V5M14 8l3-3 3 3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  sparkle: (
    <>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      <path d="M19 15l.7 1.8L21.5 17.5l-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  file: (
    <>
      <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M14 3v5h5" />
    </>
  ),
  home: (
    <>
      <path d="M4 11l8-7 8 7" />
      <path d="M6 10v9h12v-9" />
      <path d="M10 19v-5h4v5" />
    </>
  ),
  desktop: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  documents: (
    <>
      <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M9 13h6M9 17h6" />
    </>
  ),
  downloads: (
    <>
      <path d="M12 4v11" />
      <path d="M7 11l5 5 5-5" />
      <path d="M5 20h14" />
    </>
  ),
  pictures: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M4 18l5-5 4 4 3-3 4 4" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V6l10-2v12" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="16" r="2" />
    </>
  ),
  videos: (
    <>
      <rect x="3" y="5" width="14" height="14" rx="2" />
      <path d="M17 10l4-2v8l-4-2" />
    </>
  ),
  drive: (
    <>
      <rect x="3" y="8" width="18" height="9" rx="2" />
      <path d="M7 12.5h.01M11 12.5h6" />
    </>
  ),
  usb: (
    <>
      <rect x="8" y="3" width="8" height="5" rx="1" />
      <rect x="6" y="8" width="12" height="13" rx="2" />
      <path d="M10 13h.01M14 13h.01" />
    </>
  ),
  network: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
    </>
  ),
  optical: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.5-4.5" />
    </>
  ),
  up: (
    <>
      <path d="M12 19V6" />
      <path d="M6 11l6-6 6 6" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  details: <path d="M4 6h16M4 12h16M4 18h16" />,
  compact: <path d="M4 5h16M4 9h16M4 13h16M4 17h16M4 21h16" />,
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  archive: (
    <>
      <rect x="3" y="4" width="18" height="5" rx="1.5" />
      <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" />
    </>
  ),
  code: <path d="M9 7l-5 5 5 5M15 7l5 5-5 5M13.5 5l-3 14" />,
  dual: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z" />
      <circle cx="7.5" cy="11" r="1" />
      <circle cx="10" cy="7.5" r="1" />
      <circle cx="14.5" cy="7.5" r="1" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  orbit: (
    <>
      <circle cx="12" cy="12" r="3" />
      <ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(-25 12 12)" />
    </>
  )
}

interface Props {
  name: IconName
  size?: number
  className?: string
}

export function Icon({ name, size = 18, className }: Props): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {SHAPES[name]}
    </svg>
  )
}
