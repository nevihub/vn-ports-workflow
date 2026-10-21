/** Fallback shell artwork for a fresh port: a neutral launcher mark plus blank icon
 * placeholders. `scripts/make-pwa-icons.mjs` renders the real home-screen icons from
 * the original game executable into the ignored `public/game/icons/` (served in dev,
 * emitted into the build); until then these fallbacks keep the build working.
 * No game content lives here by construction. */
export function shellIcons(prefix: string): Map<string, Buffer> {
  const mark =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
    `<rect width="512" height="512" rx="112" fill="#000000"/>` +
    `<circle cx="256" cy="256" r="120" fill="none" stroke="#ffffff" stroke-width="28"/>` +
    `<path d="M246 176l96 80-96 80z" fill="#ffffff"/>` +
    `</svg>`
  // 1x1 black PNG: valid image data so manifest/icon slots resolve before game icons exist.
  const blankPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64')
  return new Map<string, Buffer>([
    [`${prefix}-shell.svg`, Buffer.from(mark, 'utf8')],
    ['icon-192.png', blankPng],
    ['icon-512.png', blankPng],
    ['apple-touch-icon.png', blankPng],
  ])
}
