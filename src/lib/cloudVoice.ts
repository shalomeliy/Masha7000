// Shali's cloud voice (Google Chirp 3 HD, Hebrew, male; server side in api/_lib/tts.ts). A reply is cut
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

const FIRST_WAIT_MS = 2500 // longer than the spike's slowest long sentence (~1.4 s)
const cache = new Map<string, Promise<Blob>>()
const CACHE_MAX = 80 // fixed phrases ("אשר", "לא מצאתי...") come back without asking again

function fetchPiece(text: string, voice: CloudVoice, rate: number): Promise<Blob> {
  const key = `${voice}|${rate}|${text}`
  const hit = cache.get(key)
  if (hit) return hit
  const p = fetch('/api/assistant?tts', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, rate }),
  }).then(async (res) => {
    if (res.ok && res.headers.get('Content-Type')?.includes('audio')) return res.blob()
    const reason = ((await res.json().catch(() => ({}))) as { reason?: string }).reason ?? String(res.status)
    if (['no-key', 'over-budget', 'not-owner', 'not-configured', 'free-only'].includes(reason) || res.status === 401) off = reason
    throw new Error(reason)
  })
  p.catch(() => cache.delete(key))
  cache.set(key, p)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
  return p
}

function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new Error('slow')), ms))])
}

let playing: HTMLAudioElement | null = null
let turn = 0

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
    } catch {
      return mine === turn ? fallback(rest(i)) : undefined
    }
    if (mine !== turn) return
    const url = URL.createObjectURL(blob)
    const a = new Audio(url)
    playing = a
    const next = () => {
      URL.revokeObjectURL(url)
      play(i + 1)
    }
    a.onended = next
    a.onerror = () => {
      URL.revokeObjectURL(url)
      if (mine === turn) fallback(rest(i))
    }
    // The phone may refuse to play sound the person did not tap for (iPhone): its own voice reads it then.
    a.play().catch(() => {
      URL.revokeObjectURL(url)
      if (mine === turn) fallback(rest(i))
    })
  }
  play(0)
}
