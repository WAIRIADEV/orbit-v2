// Listing and search events are broadcast to every pane, and each pane filters by its own request id.
// With two panes the ids MUST come from one shared counter, or two panes could pick the same id.
let counter = 0
export function nextRequestId(): number {
  return ++counter
}
