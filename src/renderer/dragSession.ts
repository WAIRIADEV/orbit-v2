// What is being dragged right now. The browser hides drag data during dragover (only the drop event can
// read it), but we need the paths on every dragover to decide whether a drop is allowed.
export interface DragSession {
  paths: string[]
}

let current: DragSession | null = null

export function startDrag(paths: string[]): void {
  current = { paths }
}
export function endDrag(): void {
  current = null
}
export function getDrag(): DragSession | null {
  return current
}
