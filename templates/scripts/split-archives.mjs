// Splits every built game archive into 1 MiB `<name>.npa.<n>` blocks (Cloudflare Pages ignores Range) and writes
// game/parts.json ({ partSize, sizes: { archive: bytes }, version: content hash }) for mountGame/preloadGame. Run after `npm run build`: node scripts/split-archives.mjs [dist]
import { readdir, stat, open, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const dir = join(process.argv[2] ?? 'dist', 'game')
const PART = 1024 * 1024 // small enough that whole-block reads stay cheap, cached by the browser
const sizes = {}, hash = createHash('sha256')
for (const f of await readdir(dir)) {
  if (!f.endsWith('.npa')) continue
  const path = join(dir, f), { size } = await stat(path)
  hash.update(f)
  const src = await open(path)
  for (let i = 0; i * PART < size; i++) {
    const buf = Buffer.alloc(Math.min(PART, size - i * PART))
    await src.read(buf, 0, buf.length, i * PART)
    hash.update(buf)
    await writeFile(`${path}.${i}`, buf)
  }
  await src.close()
  await rm(path)
  sizes[f.slice(0, -4)] = size
  console.log(f, size, '->', Math.ceil(size / PART), 'parts')
}
await writeFile(join(dir, 'parts.json'), JSON.stringify({ partSize: PART, sizes, version: hash.digest('hex').slice(0, 12) }) + '\n')
