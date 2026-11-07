// "Press here": for what the voice assistant cannot do by itself (the browser only lets a person's
// own tap open WhatsApp or the share sheet), it opens the right screen and makes the button blink
// until it is tapped. A button takes part by carrying data-hint="<id>"; ids are listed in HINTS.

export const HINTS = {
  shareWeek: 'calendar',
  urgentNow: 'calendar',
  newJob: 'calendar',
  requestConstraints: 'workers',
  joinLink: 'workers',
} as const
export type Hint = keyof typeof HINTS

const CLASS = 'hint-blink'
// The screen mounts after the tab changes; look for the button for this long.
const WAIT_MS = 4000

let last: { id: Hint; at: number } | null = null
const listeners = new Set<(id: Hint) => void>()

/** The hint asked for in the last few seconds, so a screen that mounts now can open the right tab. */
export function recentHint(): Hint | null {
  return last && Date.now() - last.at < WAIT_MS ? last.id : null
}

/** Called on every hint, for a screen that is already open; returns the unsubscribe. */
export function onHint(listener: (id: Hint) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Blinks the button with data-hint=`id` once it is on screen, until it is tapped (or 60s pass). */
export function showHint(id: Hint) {
  const started = Date.now()
  last = { id, at: started }
  listeners.forEach((l) => l(id))
  const look = () => {
    const el = document.querySelector<HTMLElement>(`[data-hint="${id}"]`)
    if (!el) {
      if (Date.now() - started < WAIT_MS) setTimeout(look, 150)
      return
    }
    el.classList.add(CLASS)
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const stop = () => el.classList.remove(CLASS)
    el.addEventListener('click', stop, { once: true })
    setTimeout(stop, 60_000)
  }
  look()
}
