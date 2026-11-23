import { vlog } from './voiceLog.js'
import { hasAiConsent } from './aiConsent.js'

// Shali's cloud voice (Gemini TTS with niqqud, or Google Chirp 3 HD; server side in api/_lib/tts.ts). A reply is cut
// into sentences, all asked for at once and played in order, so the first words are heard in about half
// a second even when the whole reply would take a second and a half (spike, docs/spikes/cloud-tts.md).
// Anything that goes wrong (no network, month's characters used up, a slow answer, the phone refusing
// to play) hands the rest of the reply to the phone's own voice: Shali is never silent.

/** Male Chirp 3 HD voices, as in api/_lib/tts.ts CLOUD_VOICES; the first is the default. */
export const CLOUD_VOICES = ['Sadaltager', 'Achird', 'Charon', 'Umbriel', 'Iapetus', 'Algieba'] as const
export type CloudVoice = (typeof CLOUD_VOICES)[number]

const MAX_PIECE = 280 // well under the server's 600
const MIN_PIECE = 25 // "אשר." alone would be its own request: glued to the next sentence

/** The text in pieces to ask for one by one: by sentence, very short ones joined, long ones cut at a comma or space. */
export function splitSentences(text: string): string[] {
  const sentences = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?…:;])\s+/).filter(Boolean)
  const cut: string[] = []
  for (const s of sentences) {
    let rest = s
    while (rest.length > MAX_PIECE) {
      const at = Math.max(rest.lastIndexOf(', ', MAX_PIECE), rest.lastIndexOf(' ', MAX_PIECE))
      const i = at > MAX_PIECE / 3 ? at + 1 : MAX_PIECE
      cut.push(rest.slice(0, i).trim())
      rest = rest.slice(i).trim()
    }
    if (rest) cut.push(rest)
  }
  const out: string[] = []
  for (const piece of cut) {
    const last = out[out.length - 1]
    if (last !== undefined && last.length < MIN_PIECE && last.length + piece.length + 1 <= MAX_PIECE) out[out.length - 1] = `${last} ${piece}`
    else out.push(piece)
  }
  // A short last one ("לאשר?") goes with the one before it.
  const tail = out[out.length - 1]
  if (out.length > 2 && tail.length < MIN_PIECE && out[out.length - 2].length + tail.length + 1 <= MAX_PIECE) out.splice(-2, 2, `${out[out.length - 2]} ${tail}`)
  return shortFirst(out)
}

// The first piece is what the manager waits for: Google answers a short one in about a third of the time
// of a long one (owner, 2026-11-14: "Shali takes much longer to answer"). So a long first sentence is
// cut at its first comma, or after a few words, and the rest follows while it plays.
const FIRST_MAX = 60
function shortFirst(pieces: string[]): string[] {
  const [first, ...rest] = pieces
  if (!first || first.length <= FIRST_MAX) return pieces
  const comma = first.indexOf(', ')
  const at = comma >= 12 && comma < FIRST_MAX ? comma + 1 : first.lastIndexOf(' ', 40)
  if (at < 12) return pieces
  return [first.slice(0, at).trim(), first.slice(at).trim(), ...rest]
}

// Why the cloud voice is off for now, after the server refused (no key, month used up, not allowed).
// Kept until the page reloads; a single slow or failed sentence does not turn it off.
let off: string | null = null
export const cloudOff = () => off

// Gemini with niqqud takes ~2.5 s a sentence and the server switches to Chirp after 4.5 s (api/_lib/tts.ts),
// so this waits past that before the phone's own voice takes over.
const FIRST_WAIT_MS = 6000
const cache = new Map<string, Promise<Blob>>()
const CACHE_MAX = 80 // fixed phrases ("אשר", "לא מצאתי...") come back without asking again

function fetchPiece(text: string, voice: CloudVoice, rate: number): Promise<Blob> {
  const key = `${voice}|${rate}|${text}`
  const hit = cache.get(key)
  if (hit) return hit
  // Without the manager's yes nothing goes to Google's voice: the phone's own voice reads it.
  if (!hasAiConsent()) return Promise.reject(new Error('no-consent'))
  const p = fetch('/api/assistant?tts', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, rate }),
  }).then(async (res) => {
    if (res.ok && res.headers.get('Content-Type')?.includes('audio')) return res.blob()
    const reason = ((await res.json().catch(() => ({}))) as { reason?: string }).reason ?? String(res.status)
    vlog(`cloud: refused ${reason}`)
    if (['no-key', 'over-budget', 'not-owner', 'not-configured', 'free-only'].includes(reason) || res.status === 401) off = reason
    throw new Error(reason)
  })
  p.catch(() => cache.delete(key))
  cache.set(key, p)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
  return p
}

/** Asks for a phrase ahead of time, so saying it later needs no wait ("רגע, בודק"). */
export function prefetchCloud(text: string, voice: CloudVoice, rate: number) {
  if (off) return
  for (const piece of splitSentences(text)) fetchPiece(piece, voice, rate).catch(() => {})
}

function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new Error('slow')), ms))])
}

let playing: HTMLAudioElement | null = null
let turn = 0

// An iPhone plays sound only from an element that first played during a tap. So one element is
// "woken" on the mic tap (a moment of silence) and reused for every sentence after it, even the ones
// that come seconds later with no tap (Dolik's iPhone heard nothing, 2026-11-16).
let player: HTMLAudioElement | null = null
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='

/** Call inside a tap: lets the cloud voice play later without one. */
export function unlockCloud() {
  if (typeof Audio === 'undefined') return
  player ??= new Audio()
  player.onended = null
  player.onerror = null
  player.src = SILENCE
  player.play().then(
    () => vlog('cloud: unlocked'),
    (e: Error) => vlog(`cloud: unlock refused ${e.name}`),
  )
}

/** Stops the cloud voice (a newer reply or the stop button). */
export function stopCloud() {
  turn++
  playing?.pause()
  playing = null
}

/**
 * Plays the text in the cloud voice. `onDone` when it ends (or was stopped); `fallback(rest)` with the part
 * not played when the cloud cannot go on, for the phone's voice to read.
 */
export function speakCloud(text: string, voice: CloudVoice, rate: number, onDone: () => void, fallback: (rest: string) => void) {
  stopCloud()
  const mine = turn
  const pieces = splitSentences(text)
  const asks = pieces.map((p) => fetchPiece(p, voice, rate))
  asks.forEach((a) => a.catch(() => {})) // each one's failure is handled where it is played
  const rest = (i: number) => pieces.slice(i).join(' ')
  const play = async (i: number) => {
    if (mine !== turn) return
    if (i >= pieces.length) return onDone()
    let blob: Blob
    try {
      blob = await timeout(asks[i], FIRST_WAIT_MS)
    } catch (e) {
      vlog(`cloud: piece ${i} not ready (${(e as Error).message})`)
      return mine === turn ? fallback(rest(i)) : undefined
    }
    if (mine !== turn) return
    const url = URL.createObjectURL(blob)
    const a = player ?? new Audio()
    a.src = url
    playing = a
    const next = () => {
      URL.revokeObjectURL(url)
      play(i + 1)
    }
    a.onended = next
    a.onerror = () => {
      vlog(`cloud: audio error ${a.error?.code ?? ''}`)
      URL.revokeObjectURL(url)
      if (mine === turn) fallback(rest(i))
    }
    // The phone may refuse to play sound the person did not tap for (iPhone): its own voice reads it then.
    a.play().then(
      () => vlog(`cloud: playing piece ${i}`),
      (e: Error) => {
        vlog(`cloud: play refused ${e.name}`)
        URL.revokeObjectURL(url)
        if (mine === turn) fallback(rest(i))
      },
    )
  }
  play(0)
}
