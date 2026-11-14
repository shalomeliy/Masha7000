// The phone's keyboard covers the bottom of the screen without always shrinking the page (iPhone, older Android,
// an installed app), so a sheet at the bottom would sit behind it with its buttons out of reach (the user's report,
// 2026-11-14). This keeps the sheet inside the part still seen: lifted above the keyboard and no taller than what
// is left, so it scrolls all the way to its buttons. Returns a function that undoes it.
export function fitToKeyboard(d: HTMLElement, win: Window = window): () => void {
  const vv = win.visualViewport
  if (!vv) return () => {}
  const fit = () => {
    const covered = Math.max(0, win.innerHeight - vv.height - vv.offsetTop)
    d.style.setProperty('--sheet-vh', `${vv.height}px`)
    d.style.marginBottom = covered > 1 ? `${covered}px` : ''
    // The field being typed in stays in view once the sheet got shorter.
    const f = win.document.activeElement as HTMLElement | null
    if (covered > 1 && f && d.contains(f) && f.matches('input, textarea, select, [contenteditable="true"]')) {
      f.scrollIntoView({ block: 'nearest' })
    }
  }
  fit()
  vv.addEventListener('resize', fit)
  vv.addEventListener('scroll', fit)
  return () => {
    vv.removeEventListener('resize', fit)
    vv.removeEventListener('scroll', fit)
    d.style.removeProperty('--sheet-vh')
    d.style.marginBottom = ''
  }
}
