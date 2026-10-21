export async function onRequest({ request, next }: {
  request: Request
  next: () => Promise<Response>
}): Promise<Response> {
  const response = await next()
  const out = new Response(response.body, response)
  // Split game blocks (`<name>.<ext>.<n>` from scripts/split-archives.mjs) cache for a year; the
  // extension is per-game (game.config.json content.archiveExtensions), so the shape — not the
  // extension — is matched. `_routes.json` runs this only on `/game/*`; everything else here
  // (notably the versioned parts.json, which must always revalidate) stays private and uncached.
  const block = response.ok && /^\/game\/[^/]+\.\d+$/.test(new URL(request.url).pathname)
  out.headers.set('Cache-Control', block ? 'private, max-age=31536000, immutable' : 'private, no-store')
  return out
}
