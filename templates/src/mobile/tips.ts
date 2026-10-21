export function mobileTips(userAgent: string, touchPoints: number, coarse: boolean, standalone: boolean) {
  const ios = /iPhone|iPad|iPod/i.test(userAgent) || /Macintosh/i.test(userAgent) && touchPoints > 1
  if (!ios && touchPoints === 0 && !coarse) return null
  return {
    audio: ios ? 'For sound on iPhone or iPad, turn off Silent Mode, raise the volume, then tap the game.'
      : 'Tap the game to enable sound, and turn up your media volume.',
    install: standalone ? '' : ios
      ? 'Install for full-screen play: in Safari, open Share → Add to Home Screen → Add. Keep “Open as Web App” on if shown.'
      : 'Install for full-screen play: open your browser menu and choose Install app or Add to Home screen, if available.',
  }
}

/** Browser guidance stays outside the original game UI; remembering dismissal is best-effort. */
export function installMobileTips() {
  const box = document.getElementById('mobiletips')!
  const tips = mobileTips(navigator.userAgent, navigator.maxTouchPoints,
    window.matchMedia('(pointer: coarse)').matches,
    window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)
  if (!tips) return
  const key = 'saya-mobile-tips-v1'
  try { if (localStorage.getItem(key) === 'dismissed') return } catch { /* denied storage must not block play */ }
  document.getElementById('mobiletips-audio')!.textContent = tips.audio
  const install = document.getElementById('mobiletips-install')!
  install.textContent = tips.install
  install.hidden = !tips.install
  box.hidden = false
  document.getElementById('mobiletips-dismiss')!.addEventListener('click', () => {
    box.hidden = true
    try { localStorage.setItem(key, 'dismissed') } catch { /* remains dismissed for this page */ }
  })
}
