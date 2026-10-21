import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

// Synthetic reference for docs/ENGINE-CAPABILITIES.md: a 5-op toy ISA over a tiny archive.
// No game content anywhere — every string below is a test token, never story text.
const SAY = 0x01, CHOICE = 0x02, JUMP = 0x03, SET = 0x04, END = 0x05

const enc = s => Buffer.from(s, 'utf8')
function op (code, ...args) { return { code, args } }

// 1. detect: magic first, honesty always.
function detect (bytes) {
  if (bytes.length >= 6 && bytes.subarray(0, 4).toString() === 'FAKE') return { format: 'fake-archive', confidence: 'PROVEN' }
  return { format: 'unknown', confidence: 'LEAD' }
}

// 2. extract: 'FAKE' + u16 count, then [u8 namelen, name, u32 size, data]. Count must match the header.
function extract (archive) {
  assert.equal(archive.subarray(0, 4).toString(), 'FAKE', 'extract runs on detected archives')
  const count = archive.readUInt16BE(4)
  const entries = []
  let at = 6
  while (entries.length < count) {
    const namelen = archive[at]; at += 1
    const name = archive.subarray(at, at + namelen).toString(); at += namelen
    const size = archive.readUInt32BE(at); at += 4
    entries.push({ name, data: archive.subarray(at, at + size) }); at += size
  }
  assert.equal(entries.length, count, 'entries == header count')
  return entries
}

// 3. decode: [op, u8 argc, argc bytes...]; failures name the offset.
function decode (bytes) {
  const ops = []
  let at = 0
  while (at < bytes.length) {
    const start = at
    const code = bytes[at]; at += 1
    if (![SAY, CHOICE, JUMP, SET, END].includes(code)) throw new Error(`decode: unknown opcode 0x${code.toString(16)} at offset ${start}`)
    if (at >= bytes.length) throw new Error(`decode: truncated argc at offset ${at}`)
    const argc = bytes[at]; at += 1
    if (at + argc > bytes.length) throw new Error(`decode: truncated args (need ${argc}) at offset ${at}`)
    ops.push({ code, args: [...bytes.subarray(at, at + argc)] }); at += argc
  }
  return ops
}

// 4. controlFlow: every jump target exists.
function controlFlow (ops) {
  const jumps = []
  ops.forEach((o, i) => { if (o.code === JUMP || o.code === CHOICE) jumps.push(...targetsOf(o).map(t => ({ from: i, to: t }))) })
  const dangling = jumps.filter(j => j.to < 0 || j.to >= ops.length)
  assert.equal(dangling.length, 0, `0 dangling jumps (first: ${JSON.stringify(dangling[0])})`)
  return { labels: ops.length, jumps }
}
const targetsOf = o => o.code === JUMP ? [o.args[0]] : o.code === CHOICE ? o.args.slice(1) : []

// 5. execute: deterministic events. CHOICE args: [n, ...targets]; input selects the target.
// stopAt pauses before that op so a test can save mid-route and resume from the frame.
function execute (ops, input = [], frame = { pc: 0, vars: {}, consumed: 0 }, stopAt = Infinity) {
  const events = []
  let { pc, vars, consumed } = { ...frame, vars: { ...frame.vars } }
  const text = bytes => Buffer.from(bytes).toString('utf8')
  let steps = 0
  while (pc < ops.length && pc !== stopAt) {
    if (++steps > 1000) throw new Error('execute: step cap hit (loop without END?)')
    const o = ops[pc]
    if (o.code === SAY) { const n = o.args[0]; events.push({ say: text(o.args.slice(1, 1 + n)) }); pc += 1 }
    else if (o.code === SET) { vars[o.args[0]] = o.args[1]; pc += 1 }
    else if (o.code === JUMP) { pc = o.args[0] }
    else if (o.code === CHOICE) { const n = o.args[0], ts = o.args.slice(1, 1 + n); events.push({ choice: n }); pc = ts[input[consumed++] ?? 0] ?? pc + 1 }
    else if (o.code === END) { events.push({ end: true }); break }
  }
  return { events, frame: { pc, vars, consumed } }
}

// 6. assets: missing ends silently in a log, never in a retry loop.
function assets (manifest, wanted) {
  const missing = []
  const found = wanted.filter(w => manifest[w] !== undefined ? true : (missing.push(w), false))
  return { found, missing }
}

// 7. save/load: the frame is plain JSON; reloading continues the same route.
const save = frame => JSON.stringify(frame)
const load = blob => { const f = JSON.parse(blob); assert.ok(Number.isInteger(f.pc), 'frame carries pc'); return f }

// 8. verify: the digest the report would score from.
const verify = events => createHash('sha256').update(JSON.stringify(events)).digest('hex')

// One toy script, two routes: SAY alpha, CHOICE [beta|gamma], END.
const scriptBytes = () => {
  const out = []
  const push = (code, ...args) => { out.push(code, args.length, ...args) }
  const t = s => { const b = [...enc(s)]; return [b.length, ...b] }
  push(SAY, ...t('alpha'))          // 0
  push(CHOICE, 2, 3, 5)             // 1 -> 3 | 5
  push(SAY, ...t('unused'))          // 2
  push(SAY, ...t('beta'))           // 3
  push(END)                         // 4
  push(SAY, ...t('gamma'))          // 5
  push(END)                         // 6
  return Buffer.from(out)
}
const archiveBytes = () => {
  const script = scriptBytes()
  const name = enc('start.bin')
  const head = Buffer.alloc(6)
  head.write('FAKE'); head.writeUInt16BE(1, 4)
  const entry = Buffer.concat([Buffer.from([name.length]), name, Buffer.from([(script.length >>> 24) & 255, (script.length >>> 16) & 255, (script.length >>> 8) & 255, script.length & 255]), script])
  return Buffer.concat([head, entry])
}

test('the 8-function surface composes on synthetic data: detect to verify', () => {
  const archive = archiveBytes()
  assert.equal(detect(archive).confidence, 'PROVEN')
  assert.equal(detect(enc('nope-no-magic-here')).confidence, 'LEAD', 'unknown magic is an explicit list item, never a guess')
  const [entry] = extract(archive)
  assert.equal(entry.name, 'start.bin')
  const ops = decode(entry.data)
  assert.equal(ops.length, 7, 'N/N entries decode')
  assert.throws(() => decode(Buffer.from([0xFF, 0x00])), /offset 0/, 'bad opcodes name the offset')
  const flow = controlFlow(ops)
  assert.equal(flow.jumps.length, 2, 'choice fans out to two targets')
  const left = execute(ops, [0])
  const right = execute(ops, [1])
  assert.deepEqual(left.events.map(e => e.say ?? (e.choice ? 'choice' : 'end')), ['alpha', 'choice', 'beta', 'end'])
  assert.deepEqual(right.events.map(e => e.say ?? (e.choice ? 'choice' : 'end')), ['alpha', 'choice', 'gamma', 'end'])
  assert.deepEqual(execute(ops, [0]).events, left.events, 'same input, same events')
})

test('save mid-route plus reload continues the same route; digests differ per route', () => {
  const ops = decode(extract(archiveBytes())[0].data)
  const part = execute(ops, [1], { pc: 0, vars: {}, consumed: 0 }, 1)
  const mid = part.frame
  assert.ok(mid.pc === 1 && !part.events.some(e => e.end), 'the save happens mid-route')
  const resumed = execute(ops, [1], load(save(mid)))
  const whole = execute(ops, [1])
  assert.deepEqual([...part.events, ...resumed.events], whole.events, 'resumed events equal the uninterrupted run')
  assert.equal(verify(whole.events), verify(execute(ops, [1]).events), 'the digest is stable')
  assert.notEqual(verify(execute(ops, [0]).events), verify(whole.events), 'routes hash differently')
  const manifest = { 'start.bin': 100 }
  assert.deepEqual(assets(manifest, ['start.bin', 'missing.bin']), { found: ['start.bin'], missing: ['missing.bin'] })
})
