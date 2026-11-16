// What the voice assistant's listening and speaking did on this phone, for the "שליחת יומן תקלות"
// button (owner, 2026-11-16: Dolik's iPhone neither heard him nor spoke). Events only, never the
// words that were said: they may hold worker names. The last 80 events, kept in memory only.

const MAX = 80
const events: string[] = []
const started = Date.now()

/** Notes one event ("listen: start", "cloud: play refused NotAllowedError"). */
export function vlog(event: string) {
  events.push(`${((Date.now() - started) / 1000).toFixed(1)}s ${event}`)
  if (events.length > MAX) events.shift()
}

/** The phone and browser facts that decide how speech works, then the events. */
export function voiceReport(extra: Record<string, unknown> = {}): string {
  const nav = navigator as Navigator & { standalone?: boolean; audioSession?: { type?: string } }
  const facts = {
    ua: nav.userAgent,
    standalone: nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true,
    speechRecognition: 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window,
    speechSynthesis: 'speechSynthesis' in window,
    voices: 'speechSynthesis' in window ? speechSynthesis.getVoices().length : 0,
    audioSession: nav.audioSession?.type ?? 'none',
    online: nav.onLine,
    lang: document.documentElement.lang,
    ...extra,
  }
  return [...Object.entries(facts).map(([k, v]) => `${k}: ${String(v)}`), '---', ...events].join('\n')
}
