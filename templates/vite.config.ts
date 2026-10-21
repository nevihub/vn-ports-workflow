import { defineConfig } from 'vite'
import { pwaShell } from './scripts/pwa'

export default defineConfig({
  plugins: [pwaShell()],
  server: {
    port: 5317,
    // Chrome locks its verification profile journals under re/ on Windows.
    watch: { ignored: ['**/re/**'] },
  },
  test: { include: ['tests/**/*.test.ts'] },
} as any)
