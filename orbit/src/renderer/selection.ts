/**
 * Selection lives outside React state, one store per pane. Ctrl+A on 50,000 files is one Set
 * mutation, not a 50,000-element array copy per keystroke. React subscribes to a version number
 * and only re-renders the rows that are on screen.
 */
export class SelectionStore {
  private set = new Set<string>()
  private listeners = new Set<() => void>()
  private version = 0

  /** Index of the focused item (the one keyboard actions start from). */
  cursor = -1
  /** Index where a Shift-range started. */
  anchor = -1

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getVersion = (): number => this.version

  has(path: string): boolean {
    return this.set.has(path)
  }

  get size(): number {
    return this.set.size
  }

  paths(): string[] {
    return Array.from(this.set)
  }

  replace(paths: Iterable<string>): void {
    this.set = new Set(paths)
    this.emit()
  }

  toggle(path: string): void {
    if (!this.set.delete(path)) this.set.add(path)
    this.emit()
  }

  clear(): void {
    this.set.clear()
    this.cursor = -1
    this.anchor = -1
    this.emit()
  }

  setCursor(index: number, anchor?: number): void {
    this.cursor = index
    if (anchor !== undefined) this.anchor = anchor
    this.emit()
  }

  private emit(): void {
    this.version++
    this.listeners.forEach((l) => l())
  }
}
