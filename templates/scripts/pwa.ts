import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { shellIcons } from './shell-icons'

/** The game id scopes the shell cache and icon names; it comes from game.config.json (ticket R1).
 *
 * OPT-IN service worker: the default scaffold excludes it (DEFAULTS.md: manifest + icons only) and
 * PORTING-GUIDE.md allows it solely as a shell-only cache — never precache the game, which always
 * uses the network. Include `pwaShell()` in `vite.config.ts` only for explicit offline starts. */
function gameId(): string {
  try {
    const id = JSON.parse(readFileSync(join(process.cwd(), 'game.config.json'), 'utf8'))?.game?.id
    if (typeof id === 'string' && /^[a-z][a-z0-9-]{1,30}$/.test(id)) return id
  } catch { /* fall through to the warning below */ }
  console.warn('pwa: game.config.json is missing or has no game.id; using the "game" cache prefix')
  return 'game'
}

/** One immutable shell cache per build; game archives and Range reads always use the network. */
export function shellWorker(files: string[], cache: string, prefix: string): string {
  return `const CACHE = '${cache}';
const FILES = ${JSON.stringify(files)};
const ROOT = self.registration.scope;
const URLS = FILES.map(path => new URL(path, ROOT).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('${prefix}-shell-') && key !== CACHE)
    .map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || request.headers.has('range')) return;
  if (url.origin !== self.location.origin || !URLS.includes(url.origin + url.pathname)) return;
  // The page itself is network-first, so a new deploy loads its own engine build; the cache covers offline starts.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.open(CACHE).then(cache => cache.match(url.origin + url.pathname))));
    return;
  }
  event.respondWith(caches.open(CACHE).then(cache => cache.match(url.origin + url.pathname)
    .then(cached => cached || fetch(request))));
});
// No skipWaiting/clients.claim: a running tab keeps its engine build; the next page load takes the new one.
`
}

export function pwaShell(): Plugin {
  const id = gameId()
  const icons = shellIcons(`${id}`)
  let root = ''
  // Home-screen icons prefer the original game icon rendered into the ignored public/game/icons/ by
  // scripts/make-pwa-icons.mjs; the tracked fallback mark above is used when no game data is present.
  const iconBytes = (name: string, fallback: Buffer): Buffer => {
    const path = join(root, 'public/game/icons', name)
    return existsSync(path) ? readFileSync(path) : fallback
  }
  return {
    name: `${id}-private-app-shell`, enforce: 'post',
    configResolved(config) { root = config.root },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Split instead of new URL(): odd request targets like "//" would 500 the dev server.
        const name = (req.url ?? '/').split('?')[0].replace(/^\/icons\//, '')
        const fallback = icons.get(name)
        if (!fallback) { next(); return }
        const data = iconBytes(name, fallback)
        res.setHeader('Content-Type', name.endsWith('.svg') ? 'image/svg+xml' : 'image/png'); res.end(data)
      })
    },
    generateBundle(_options, bundle) {
      for (const [name, source] of icons) this.emitFile({ type: 'asset', fileName: `icons/${name}`, source: iconBytes(name, source) })
      const assets = Object.keys(bundle).filter(name => /\.(?:html|js|css|woff2?)$/.test(name))
      const files = [...new Set(['./', ...assets.filter(name => name !== 'index.html').map(name => `./${name}`),
        './manifest.webmanifest', ...[...icons.keys()].map(name => `./icons/${name}`)])]
      const hash = createHash('sha256')
      for (const name of assets.sort()) {
        const item = bundle[name]
        hash.update(name).update(item.type === 'chunk' ? item.code : item.source)
      }
      // Worker policy changes must produce a new cache even when application chunks are unchanged.
      const cacheName = (version: string) => `${id}-shell-${version}`
      hash.update(shellWorker(files, cacheName('version'), `${id}`))
      for (const [name, data] of icons) hash.update(iconBytes(name, data))
      hash.update(readFileSync(join(root, 'public', 'manifest.webmanifest')))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: shellWorker(files, cacheName(hash.digest('hex').slice(0, 16)), `${id}`) })
    },
  }
}
