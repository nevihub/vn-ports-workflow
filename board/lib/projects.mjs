// projects.json: each project lists candidate paths (relative to the board folder first); the first existing one wins.
// `agents` (top level, per project overrides per agent) says which tickets each agent may take on its own:
//   { "opencode": { "types": ["verify", "grunt", "test"] } } - lanes/types are allowlists; no entry = anything.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROJECTS_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'projects.json')

export function loadProjects (file = PROJECTS_FILE) {
  const cfg = JSON.parse(readFileSync(file, 'utf8'))
  return cfg.projects.map(p => {
    const root = (p.paths ?? []).map(x => (isAbsolute(x) ? x : resolve(dirname(file), x))).find(x => existsSync(x)) ?? null
    return { ...p, root, agentRules: { ...(cfg.agents ?? {}), ...(p.agents ?? {}) } }
  })
}
