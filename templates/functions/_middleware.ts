export async function onRequest({ request, next }: {
  request: Request
  next: () => Promise<Response>
}): Promise<Response> {
  const response = await next()
  const out = new Response(response.body, response)
  const block = response.ok && /^\/game\/[a-z]+\.npa\.\d+$/.test(new URL(request.url).pathname)
  out.headers.set('Cache-Control', block ? 'private, max-age=31536000, immutable' : 'private, no-store')
  return out
}
