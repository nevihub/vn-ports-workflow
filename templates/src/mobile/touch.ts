/** Presentation-only touch mapping onto the engine's existing mouse event contract. */
export interface TouchGame {
  hover(x: number, y: number, down?: boolean): void
  pushEvent(event: { kind: 'click' | 'release' | 'rclick' }): void
  audio: { resume(): void }
  world?: { drawList(): { o: { kind: string; tex: unknown; opacity: number; x: number; y: number; width: number; height: number }; ox: number; oy: number; alpha: number }[] }
}
export const LONG_PRESS_MS = 550
const DRAG_PX = 12

type Press = { id: number; x: number; y: number; held: boolean; dragging: boolean; timer: ReturnType<typeof setTimeout> | null; game: TouchGame }

export function installTouch(canvas: HTMLCanvasElement, game: () => TouchGame | undefined, canDrag?: (x: number, y: number) => boolean) {
  let press: Press | null = null
  const cancel = () => {
    const active = press
    press = null
    if (active?.timer) clearTimeout(active.timer)
    if (active?.dragging) active.game.pushEvent({ kind: 'release' })
    else if (active) active.game.hover(-1, -1, false)
  }
  const coordinates = (x: number, y: number) => {
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    return { x: (x - rect.left) * 800 / rect.width, y: (y - rect.top) * 600 / rect.height }
  }
  const point = (x: number, y: number) => {
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height || x < rect.left || y < rect.top || x >= rect.right || y >= rect.bottom) return null
    return coordinates(x, y)
  }
  const dispatch = (g: TouchGame, x: number, y: number, kind: 'click' | 'rclick') => {
    const p = point(x, y)
    if (!g || !p) return
    g.hover(p.x, p.y)
    g.pushEvent({ kind })
    // Case-free select loops can consume the release from the same tap that selected a button.
    g.pushEvent({ kind: 'release' })
    // A lifted finger no longer hovers: otherwise MouseOver art hides stateful buttons such as Repeat.
    // The queued click already owns its hit target, so leaving cannot change which choice it activates.
    g.hover(-1, -1)
  }
  const down = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return
    e.preventDefault() // Suppress compatibility mousedown; the desktop entry point already handles it.
    if (!e.isPrimary || press) { cancel(); return }
    const p = point(e.clientX, e.clientY), g = game()
    if (!p || !g) return
    g.audio.resume()
    const dragging = !!canDrag?.(p.x, p.y)
    let timer: ReturnType<typeof setTimeout> | null = null
    if (!dragging) {
      // Show the original MouseClick state while the finger is down; activation stays on release.
      // Sending a gameplay click here would also advance text for a cancelled or long press.
      g.hover(p.x, p.y, true)
      timer = setTimeout(() => {
        if (!press || press.id !== e.pointerId) return
        press.held = true
        press.game.hover(-1, -1, false)
        dispatch(press.game, press.x, press.y, 'rclick')
      }, LONG_PRESS_MS)
    }
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, held: false, dragging, timer, game: g }
    try { canvas.setPointerCapture(e.pointerId) } catch { /* pointer was cancelled before capture */ }
    if (dragging) {
      g.hover(p.x, p.y)
      g.pushEvent({ kind: 'click' })
    }
  }
  const move = (e: PointerEvent) => {
    if (press?.id !== e.pointerId) return
    if (press.dragging) {
      const p = coordinates(e.clientX, e.clientY)
      if (p) press.game.hover(p.x, p.y)
      return
    }
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_PX) cancel()
  }
  const up = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return
    e.preventDefault()
    if (press?.id !== e.pointerId) return
    const active = press, held = active.held, dragging = active.dragging
    if (dragging) {
      const p = coordinates(e.clientX, e.clientY)
      if (p) active.game.hover(p.x, p.y)
    }
    cancel()
    if (!dragging && !held) dispatch(active.game, e.clientX, e.clientY, 'click')
  }
  canvas.addEventListener('pointerdown', down, { passive: false })
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up, { passive: false })
  canvas.addEventListener('pointercancel', cancel)
  canvas.addEventListener('lostpointercapture', cancel)
  const hide = () => { if (document.hidden) cancel() }
  document.addEventListener('visibilitychange', hide)
  window.addEventListener('pagehide', cancel)
  return () => {
    cancel()
    canvas.removeEventListener('pointerdown', down)
    canvas.removeEventListener('pointermove', move)
    canvas.removeEventListener('pointerup', up)
    canvas.removeEventListener('pointercancel', cancel)
    canvas.removeEventListener('lostpointercapture', cancel)
    document.removeEventListener('visibilitychange', hide)
    window.removeEventListener('pagehide', cancel)
  }
}
