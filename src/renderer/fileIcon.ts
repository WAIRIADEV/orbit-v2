import type { FileKind } from '@shared/fileKind'
import type { IconName } from './Icons'

export const KIND_ICON: Record<FileKind, IconName> = {
  folder: 'folder',
  image: 'pictures',
  video: 'videos',
  audio: 'music',
  document: 'documents',
  pdf: 'documents',
  archive: 'archive',
  code: 'code',
  file: 'file'
}

export const KIND_LABEL: Record<FileKind, string> = {
  folder: 'Folder',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  document: 'Document',
  pdf: 'PDF document',
  archive: 'Archive',
  code: 'Source / data file',
  file: 'File'
}
