import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { shellIcons } from './shell-icons'

/** One immutable shell cache per build; NPA archives and Range reads always use the network. */
export function shellWorker(files: string[], version: string): string {
  return `const CACHE = 'saya-shell-${version}';
const FILES = ${JSON.stringify(files)};
const ROOT = self.registration.scope;
const URLS = FILES.map(path => new URL(path, ROOT).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(URLS)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('saya-shell-') && key !== CACHE)
    .map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || request.headers.has('range') || /\\.npa$/i.test(url.pathname)) return;
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
  const icons = shellIcons()
  let root = ''
  // Home-screen icons prefer the original game icon rendered into the ignored public/game/icons/ by
  // scripts/make-pwa-icons.mjs; the tracked launcher mark is the fallback when no game data is present.
  const iconBytes = (name: string, fallback: Buffer): Buffer => {
    const path = join(root, 'public/game/icons', name)
    return existsSync(path) ? readFileSync(path) : fallback
  }
  return {
    name: 'saya-private-app-shell', enforce: 'post',
    configResolved(config) { root = config.root },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Split instead of new URL(): odd request targets like "//" throw and would 500 the dev server.
        const name = (req.url ?? '/').split('?')[0].replace(/^\/icons\//, '')
        const fallback = icons.get(name)
        if (!fallback) { next(); return }
        const data = iconBytes(name, fallback)
        res.setHeader('Content-Type', 'image/png'); res.end(data)
      })
    },
    generateBundle(_options, bundle) {
      for (const [name, source] of icons) this.emitFile({ type: 'asset', fileName: `icons/${name}`, source: iconBytes(name, source) })
      const assets = Object.keys(bundle).filter(name => /\.(?:html|js|css|woff2?)$/.test(name))
      const files = [...new Set(['./', ...assets.filter(name => name !== 'index.html').map(name => `./${name}`),
        './manifest.webmanifest', './icons/saya-shell.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'])]
      const hash = createHash('sha256')
      for (const name of assets.sort()) {
        const item = bundle[name]
        hash.update(name).update(item.type === 'chunk' ? item.code : item.source)
      }
      // Worker policy changes must produce a new cache even when application chunks are unchanged.
      hash.update(shellWorker(files, 'version'))
      for (const [name, data] of icons) hash.update(iconBytes(name, data))
      for (const name of ['manifest.webmanifest', 'icons/saya-shell.svg']) hash.update(readFileSync(join(root, 'public', name)))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: shellWorker(files, hash.digest('hex').slice(0, 16)) })
    },
  }
}
