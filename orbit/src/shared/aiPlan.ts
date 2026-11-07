// Plans the AI proposes. Shared: the main process validates them, the renderer shows and applies them.
import type { AiPlan, OpRequest, PlanAction } from './types.ts'
import { baseName } from './paths.ts'

export const MAX_ACTIONS = 40
export const MAX_PATHS_PER_ACTION = 200

/** One Apply click becomes these queue requests, in order. */
export function planToRequests(plan: AiPlan): OpRequest[] {
  return plan.actions.map((a): OpRequest => {
    switch (a.type) {
      case 'mkdir':
        return { kind: 'mkdir', sources: [], target: a.parent, name: a.name }
      case 'move':
        return { kind: 'move', sources: a.paths, target: a.to }
      case 'copy':
        return { kind: 'copy', sources: a.paths, target: a.to }
      case 'rename':
        return { kind: 'rename', sources: [a.path], target: a.newName }
      case 'trash':
        return { kind: 'trash', sources: a.paths }
    }
  })
}

const items = (n: number): string => (n === 1 ? '1 item' : `${n} items`)

/** A plain-English line for the plan card. */
export function describeAction(a: PlanAction): string {
  switch (a.type) {
    case 'mkdir':
      return `Create folder “${a.name}” in ${baseName(a.parent) || a.parent}`
    case 'move':
      return `Move ${a.paths.length === 1 ? `“${baseName(a.paths[0] ?? '')}”` : items(a.paths.length)} to ${baseName(a.to) || a.to}`
    case 'copy':
      return `Copy ${a.paths.length === 1 ? `“${baseName(a.paths[0] ?? '')}”` : items(a.paths.length)} to ${baseName(a.to) || a.to}`
    case 'rename':
      return `Rename “${baseName(a.path)}” to “${a.newName}”`
    case 'trash':
      return `Move ${a.paths.length === 1 ? `“${baseName(a.paths[0] ?? '')}”` : items(a.paths.length)} to the Recycle Bin`
  }
}
