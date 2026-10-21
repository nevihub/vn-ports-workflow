// Finds where the page freezes: autoplay (skip) to a scene, play it at normal speed, and if the page stops answering,
// pause it via the Chrome DevTools Protocol and print the JS call stack (function, file:line only — never game text).
// Usage: node scripts/freeze-stack.mjs <normalFromScene.nss> '<route json>' [origin] [watchSeconds]
// Env: GAME_PLAYWRIGHT_MODULE, GAME_BROWSER_CHANNEL (as for run-browser-check.mjs).
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'

const [scene, route = '[]', origin = 'http://localhost:5317', watch = '600'] = process.argv.slice(2)
if (!scene) throw new Error('Usage: node scripts/freeze-stack.mjs <scene.nss> <route json> [origin] [watchSeconds]')
const { chromium } = createRequire(import.meta.url)(process.env.GAME_PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.GAME_BROWSER_CHANNEL })
const page = await browser.newPage()
const cdp = await page.context().newCDPSession(page)
await cdp.send('Debugger.enable') // must be enabled before the freeze: a busy page cannot process enable
try {
  await page.goto(origin)
  await page.waitForFunction(() => !!window.game, null, { timeout: 30000 })
  const autoplay = await readFile(new URL('./autoplay.js', import.meta.url), 'utf8')
  await page.evaluate(([code, scene, route]) => {
    window.__autoplayOptions = { mode: 'skip', normalFrom: scene, pauseMs: 300, maxMs: 3_600_000 }
    window.__route = route
    ;(0, eval)(code)
  }, [autoplay, scene, JSON.parse(route)])
  const deadline = Date.now() + Number(watch) * 1000
  let last = null
  while (Date.now() < deadline) {
    const state = await Promise.race([
      page.evaluate(() => ({ mode: __log.mode, scene: __log.scenes.at(-1), n: __log.scenes.length, errors: __log.errors.length,
        frame: (f => f && `${f.r.file}:${f.r.name}@${f.pc}`)(game.vm.main.frames.at(-1)) })),
      new Promise(r => setTimeout(() => r(null), 10000)),
    ])
    if (!state) {
      console.log('FROZEN after', JSON.stringify(last))
      // Sample a few pauses; while paused, read engine state (names, kinds, counters only).
      const probe = `JSON.stringify({ threads: game.vm.threads.map(t => ({ name: t.name, paused: t.paused,
        top: (f => f && f.r.file + ':' + f.r.name + '@' + f.pc)(t.frames.at(-1)),
        wait: (() => { try { return t.wait?.save?.() ?? null } catch (e) { return 'unsaveable' } })() })),
        texts: [...game.text.texts.values()].map(t => t.obj.path + ':' + t.state + ':' + t.pos + '/' + t.pieces.length),
        selects: game.selectWaits.size, choices: game.choices().length, busy: game.busy, events: game.events?.length ?? null })`
      for (let sample = 0; sample < 4; sample++) {
        const paused = new Promise(r => cdp.once('Debugger.paused', r))
        await cdp.send('Debugger.pause')
        const { callFrames } = await Promise.race([paused, new Promise((_, no) => setTimeout(() => no(new Error('no pause within 30 s')), 30000))])
        console.log(`sample ${sample}:`)
        for (const f of callFrames.slice(0, 25)) console.log(`  ${f.functionName || '(anonymous)'}  ${f.url.replace(origin, '')}:${f.location.lineNumber + 1}`)
        if (sample === 0) {
          const { result } = await cdp.send('Debugger.evaluateOnCallFrame', { callFrameId: callFrames[0].callFrameId, expression: probe })
          console.log('  state', result.value ?? result.description)
        }
        await cdp.send('Debugger.resume').catch(() => {})
        await new Promise(r => setTimeout(r, 1500))
      }
      process.exitCode = 2
      break
    }
    if (state.scene !== last?.scene || state.mode !== last?.mode) console.log(JSON.stringify(state))
    last = state
    await new Promise(r => setTimeout(r, 2000))
  }
} finally { await browser.close().catch(() => {}) }
