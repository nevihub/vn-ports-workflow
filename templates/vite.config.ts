import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import { pwaShell } from './scripts/pwa'

// The dev port is per-game (game.config.json build.devPort, ticket R1); placeholders refuse to boot.
function devPort(): number {
  try {
    const port = JSON.parse(readFileSync(join(process.cwd(), 'game.config.json'), 'utf8'))?.build?.devPort
    if (Number.isSafeInteger(port) && port >= 1024 && port <= 65535) return port
  } catch { /* fall through to the error below */ }
  throw new Error('vite: game.config.json is missing or has no build.devPort (scaffold it, then fill ticket R1)')
}

export default defineConfig({
  plugins: [pwaShell()],
  server: {
    port: devPort(),
    // Chrome locks its verification profile journals under re/ on Windows.
    watch: { ignored: ['**/re/**'] },
  },
  test: { include: ['tests/**/*.test.ts'] },
} as any)
