// Runs after `npm install`. Some npm setups block dependency install scripts (you see
// "install scripts blocked" for electron and esbuild), which leaves Electron without its binary
// ("Error: Electron uninstall"). This runs those two scripts for us, so a plain `npm install` is enough.
// It never fails the install: if something goes wrong it prints what to do instead.
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const targets = [
  { name: 'electron', file: join(root, 'node_modules', 'electron', 'install.js'), done: () => existsSync(join(root, 'node_modules', 'electron', 'path.txt')) },
  { name: 'esbuild', file: join(root, 'node_modules', 'esbuild', 'install.js'), done: () => false }
]

for (const t of targets) {
  if (!existsSync(t.file)) continue
  if (t.done()) continue
  const r = spawnSync(process.execPath, [t.file], { cwd: root, stdio: 'inherit' })
  if (r.status !== 0) console.warn(`[orbit] ${t.name} setup did not finish. Run: node node_modules/${t.name}/install.js`)
}
