export interface Accent {
  id: string
  label: string
  /** Accent colour used on the dark theme (light tone) and on the light theme (deep tone). */
  dark: string
  light: string
}

export const ACCENTS: Accent[] = [
  { id: 'indigo', label: 'Indigo', dark: '#b8c3ff', light: '#4455c8' },
  { id: 'blue', label: 'Blue', dark: '#8ccbff', light: '#1565c0' },
  { id: 'teal', label: 'Teal', dark: '#6fe0c0', light: '#0b7f6b' },
  { id: 'green', label: 'Green', dark: '#9be08f', light: '#2e7d32' },
  { id: 'amber', label: 'Amber', dark: '#f2c66d', light: '#a35a00' },
  { id: 'orange', label: 'Orange', dark: '#ffab7d', light: '#c2410c' },
  { id: 'rose', label: 'Rose', dark: '#ff9fc4', light: '#c2185b' },
  { id: 'violet', label: 'Violet', dark: '#d6adff', light: '#7c3aed' }
]

export const DEFAULT_ACCENT = 'indigo'

export function findAccent(id: string | null | undefined): Accent {
  return ACCENTS.find((a) => a.id === id) ?? (ACCENTS[0] as Accent)
}

function channel(v: number): number {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

/** WCAG contrast ratio between two #rrggbb colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Text colour that stays readable on top of an accent-filled button. */
export function onAccent(hex: string): string {
  const light = '#ffffff'
  const dark = '#14141a'
  return contrastRatio(hex, light) >= contrastRatio(hex, dark) ? light : dark
}
