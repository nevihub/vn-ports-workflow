/** The touch Skip button has the same lifetime as holding the original Ctrl key. */
export function installHoldSkip(button: HTMLButtonElement, setHeld: (held: boolean) => void) {
  let pointer: number | null = null, keyboard = false, held = false
  const refresh = () => {
    const next = pointer !== null || keyboard
    if (held !== next) { held = next; setHeld(held) }
    button.classList.toggle('active', held)
    button.setAttribute('aria-pressed', String(held))
  }
  const cancel = () => { pointer = null; keyboard = false; refresh() }
  const down = (e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!e.isPrimary || e.button !== 0 || pointer !== null) return
    pointer = e.pointerId
    try { button.setPointerCapture(e.pointerId) } catch { /* cancellation can precede capture */ }
    refresh()
  }
  const up = (e: PointerEvent) => {
    if (pointer !== e.pointerId) return
    e.preventDefault()
    e.stopPropagation()
    pointer = null
    refresh()
  }
  const keydown = (e: KeyboardEvent) => {
    if (e.key !== ' ' && e.key !== 'Enter') return
    e.preventDefault(); e.stopPropagation()
    keyboard = true; refresh()
  }
  const keyup = (e: KeyboardEvent) => {
    if (e.key !== ' ' && e.key !== 'Enter') return
    e.preventDefault(); e.stopPropagation()
    keyboard = false; refresh()
  }
  const suppress = (e: Event) => { e.preventDefault(); e.stopPropagation() }
  const hide = () => { if (document.hidden) cancel() }
  button.addEventListener('pointerdown', down)
  button.addEventListener('pointerup', up)
  button.addEventListener('pointercancel', up)
  button.addEventListener('lostpointercapture', up)
  button.addEventListener('keydown', keydown)
  button.addEventListener('keyup', keyup)
  button.addEventListener('click', suppress)
  button.addEventListener('contextmenu', suppress)
  button.addEventListener('blur', cancel)
  window.addEventListener('pointerup', up)
  window.addEventListener('blur', cancel)
  window.addEventListener('pagehide', cancel)
  document.addEventListener('visibilitychange', hide)
  refresh()
  return () => {
    cancel()
    button.removeEventListener('pointerdown', down)
    button.removeEventListener('pointerup', up)
    button.removeEventListener('pointercancel', up)
    button.removeEventListener('lostpointercapture', up)
    button.removeEventListener('keydown', keydown)
    button.removeEventListener('keyup', keyup)
    button.removeEventListener('click', suppress)
    button.removeEventListener('contextmenu', suppress)
    button.removeEventListener('blur', cancel)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('blur', cancel)
    window.removeEventListener('pagehide', cancel)
    document.removeEventListener('visibilitychange', hide)
  }
}
