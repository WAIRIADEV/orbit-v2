export type FileKind =
  | 'folder'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'pdf'
  | 'archive'
  | 'code'
  | 'file'

const GROUPS: Array<[FileKind, string]> = [
  ['image', 'png jpg jpeg gif webp bmp svg ico heic tiff avif'],
  ['video', 'mp4 mkv mov avi webm wmv flv m4v'],
  ['audio', 'mp3 wav flac aac ogg m4a wma opus'],
  ['pdf', 'pdf'],
  ['document', 'doc docx txt rtf odt md xls xlsx csv ppt pptx odp ods'],
  ['archive', 'zip rar 7z tar gz bz2 xz iso'],
  ['code', 'js jsx ts tsx json html css py java c cpp h cs go rs php sh bat ps1 yml yaml xml sql ipynb']
]

const BY_EXTENSION = new Map<string, FileKind>()
for (const [kind, list] of GROUPS) for (const ext of list.split(' ')) BY_EXTENSION.set(ext, kind)

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function fileKind(name: string, isDir: boolean): FileKind {
  if (isDir) return 'folder'
  return BY_EXTENSION.get(extensionOf(name)) ?? 'file'
}
