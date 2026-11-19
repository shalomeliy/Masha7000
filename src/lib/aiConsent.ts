// The manager's yes before anything leaves for an outside AI (App Store 5.1.2(i), Google Play User Data):
// what is said to Shali goes to Claude (Anthropic) when the app cannot do it free, and Shali's cloud voice
// sends the text it speaks to Google. Without the yes, Shali still does the free commands the app knows
// and speaks with the phone's own voice. Kept on this device; Settings > החשבון שלי takes it back.

const KEY = 'shiftsmart.aiConsent'
const VERSION = 1 // raise when what is sent changes: everyone is asked again

const listeners = new Set<(on: boolean) => void>()

export function hasAiConsent(): boolean {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as { v?: number }).v === VERSION : false
  } catch {
    return false
  }
}

export function setAiConsent(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, JSON.stringify({ v: VERSION, at: new Date().toISOString() }))
    else localStorage.removeItem(KEY)
  } catch {
    // Storage blocked (private mode): asked again next time.
  }
  listeners.forEach((fn) => fn(on))
}

export function onAiConsent(fn: (on: boolean) => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
