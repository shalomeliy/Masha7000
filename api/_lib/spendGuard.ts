// The app's Anthropic key pays real money and has a small monthly cap (the user's rule, 2026-11-06:
// a local translation run once used the whole month). So a paid call may only leave from Vercel.
// On this machine (dev server, tests, spikes, scripts) every paid call is refused here, before any
// request is made, whatever key is around.

/** True only inside a Vercel deployment (Vercel sets VERCEL=1 there, never locally). */
export function onVercel(e: NodeJS.ProcessEnv = process.env): boolean {
  return e.VERCEL === '1'
}

/** Throws unless running on Vercel. Call it right before creating any Anthropic client. */
export function assertPaidCallAllowed(e: NodeJS.ProcessEnv = process.env): void {
  if (!onVercel(e)) throw new Error('Paid Anthropic calls are blocked outside Vercel (see CLAUDE.md, "Never spend the API key locally")')
}
