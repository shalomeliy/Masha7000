// Dev server only: the owner's switch on the assistant screen. Off (the default): the local
// /api/assistant answers with a fixed stand-in and costs nothing. On: it really asks Claude with the
// key in .env.local, for the owner's own manual tests (paid). Kept per browser, so Claude's browser,
// where it is never turned on, always gets the stand-in (CLAUDE.md "Never spend the API key locally").
const KEY = 'dev.realAssistant'

export function realAssistantOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setRealAssistant(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    // no storage: stays off
  }
}
