// Renders the home-screen / PWA icons from the original game icon into public/game/icons/ (git-ignored).
// The largest icon resource of saya.exe is extracted, composited on black, and scaled with ffmpeg.
// Usage: node scripts/make-pwa-icons.mjs ["<game dir or saya.exe>"]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const DEFAULT = '<game-install>'
const input = process.argv[2] || process.env.GAME_GAME_DIR || DEFAULT
const exe = input.toLowerCase().endsWith('.exe') ? input : path.join(input, 'saya.exe')
const outDir = path.resolve('public/game/icons')
if (!fs.existsSync(exe)) {
  console.warn(`make-pwa-icons: saya.exe not found at ${exe}; keeping any existing icons.`)
  process.exit(0)
}

const buf = fs.readFileSync(exe)
const u16 = o => buf.readUInt16LE(o), u32 = o => buf.readUInt32LE(o)
if (u16(0) !== 0x5a4d) throw new Error('not MZ')
const pe = u32(0x3c), coff = pe + 4
const opt = coff + 20, magic = u16(opt)
const dirOff = opt + (magic === 0x20b ? 112 : 96)
const resRva = u32(dirOff + 16), resSize = u32(dirOff + 20)
const sections = u16(coff + 2), sectionsOff = opt + u16(coff + 16)
const toOffset = rva => {
  for (let i = 0; i < sections; i++) {
    const s = sectionsOff + i * 40
    const va = u32(s + 12), vs = u32(s + 8), raw = u32(s + 20)
    if (rva >= va && rva < va + Math.max(vs, u32(s + 16))) return raw + (rva - va)
  }
  throw new Error(`rva ${rva} not mapped`)
}
const resBase = toOffset(resRva)
const icons = new Map()
const walk = (dirOffAbs, depth, ids) => {
  const n = u16(dirOffAbs + 12) + u16(dirOffAbs + 14)
  for (let i = 0; i < n; i++) {
    const e = dirOffAbs + 16 + i * 8
    const name = u32(e), child = u32(e + 4)
    const id = name & 0x80000000 ? null : name
    if (child & 0x80000000) walk(resBase + (child & 0x7fffffff), depth + 1, [...ids, id])
    else if (ids[0] === 3 && id !== null) { // RT_ICON
      const dataRva = u32(resBase + child), size = u32(resBase + child + 4)
      icons.set(id, { data: buf.subarray(toOffset(dataRva), toOffset(dataRva) + size), size })
    }
  }
}
walk(resBase, 0, [])
if (!icons.size) throw new Error('no icon resources in the executable')
const entries = [...icons.entries()].sort((a, b) => b[1].size - a[1].size)
const [, largest] = entries[0]

// Decode the bitmap ourselves: the 8bpp frames rely on the AND mask, which ffmpeg's ICO decoder drops.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'saya-icons-'))
const framePath = path.join(tmp, 'frame.ppm')
const isPng = largest.data.length > 8 && largest.data.readUInt32BE(0) === 0x89504e47
if (isPng) {
  throw new Error('PNG-compressed icons are not handled yet')
}
{
  const bmp = largest.data
  const width = bmp.readInt32LE(4), height = bmp.readInt32LE(8) / 2
  const bpp = bmp.readUInt16LE(14), clrUsed = bmp.readUInt32LE(32) || (bpp === 8 ? 256 : 0)
  const palette = []
  for (let i = 0; i < clrUsed; i++) {
    const at = 40 + i * 4
    palette.push([bmp[at + 2], bmp[at + 1], bmp[at]])
  }
  const xorStride = bpp === 8 ? (width + 3) & ~3 : width * 4
  const xor = bmp.subarray(40 + clrUsed * 4, 40 + clrUsed * 4 + xorStride * height)
  const maskStride = ((width + 31) >> 5) * 4
  const mask = bmp.subarray(40 + clrUsed * 4 + xorStride * height, 40 + clrUsed * 4 + xorStride * height + maskStride * height)
  const rgb = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const row = height - 1 - y
      const masked = (mask[row * maskStride + (x >> 3)] >> (7 - (x & 7))) & 1
      let r = 0, g = 0, b = 0
      if (!masked) {
        if (bpp === 8) [r, g, b] = palette[xor[row * xorStride + x]]
        else { const at = row * xorStride + x * 4; b = xor[at]; g = xor[at + 1]; r = xor[at + 2]; const a = bpp === 32 ? xor[at + 3] / 255 : 1; r *= a; g *= a; b *= a }
      }
      const at = (y * width + x) * 3
      rgb[at] = r; rgb[at + 1] = g; rgb[at + 2] = b
    }
  }
  fs.writeFileSync(framePath, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`, 'latin1'), rgb]))
}

fs.mkdirSync(outDir, { recursive: true })
const targets = [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]
for (const [name, size] of targets) {
  const out = path.join(outDir, name)
  const run = spawnSync('ffmpeg', ['-y', '-loglevel', 'error',
    '-i', framePath,
    '-vf', `scale=${size}:${size}:flags=lanczos`,
    '-frames:v', '1', out], { stdio: 'inherit', windowsHide: true })
  if (run.error || run.status !== 0) {
    console.warn('make-pwa-icons: ffmpeg is unavailable; keeping any existing icons.')
    process.exit(0)
  }
  console.log('wrote', out)
}
fs.rmSync(tmp, { recursive: true, force: true })
