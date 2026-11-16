import { language, tx } from '../i18n'
import { joinTranscripts } from './dictation'
import { CLOUD_VOICES, cloudOff, prefetchCloud, speakCloud, stopCloud, unlockCloud, type CloudVoice } from './cloudVoice'
import { pronounce } from './pronounce'
import { rankVoices, shortVoiceName, speakable } from './speakable'

// Speech in and out in the app's language, for the voice assistant. In: the browser's speech recognition,
// as in DictationField. Out: in Hebrew, Shali's cloud voice (cloudVoice.ts) by default; else, and whenever the
// cloud cannot speak, the browser's speech synthesis, free and on the phone itself.

interface Recognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}
type RecognitionCtor = new () => Recognition

const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
const Speech = w.SpeechRecognition ?? w.webkitSpeechRecognition

// iPhone (and iPad, which says it is a Mac): its listening and its sound need their own care below.
const isIOS =
  typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

// Installed on an iPhone's home screen, the page's speech recognition starts but never hears anything
// (WebKit bug 225298; Dolik, 2026-11-16: stuck on "listening"). There the keyboard's own mic is used.
export const iosHomeApp =
  isIOS &&
  ((navigator as unknown as { standalone?: boolean }).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true)

export const canListen = Boolean(Speech) && !iosHomeApp
export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window

export const LISTEN_ERRORS: Record<string, string> = {
  'not-allowed': tx('אין הרשאה למיקרופון. אפשר לאשר אותה בהגדרות הדפדפן.'),
  'service-not-allowed': tx('אין הרשאה למיקרופון. אפשר לאשר אותה בהגדרות הדפדפן.'),
  network: tx('זיהוי הדיבור צריך אינטרנט.'),
  'no-speech': tx('לא נשמע דיבור. נסה שוב.'),
}


// Safari's audio session: after the microphone, an iPhone may keep sound in "call" mode (quiet, or
// none). 'playback' before speaking puts it back on the speaker; 'auto' before listening.
function audioSession(type: 'auto' | 'playback') {
  try {
    const s = (navigator as unknown as { audioSession?: { type: string } }).audioSession
    if (s) s.type = type
  } catch {
    // older Safari or another browser: nothing to set
  }
}

let unlocked = false
/**
 * Call inside the tap that starts listening. An iPhone plays sound only after a tap, and the answer
 * comes seconds later: so the cloud voice and the phone's voice are both woken now, silently.
 */
export function unlockSpeech() {
  unlockCloud()
  if (unlocked || !canSpeak) return
  unlocked = true
  const u = new SpeechSynthesisUtterance(' ')
  u.volume = 0
  speechSynthesis.speak(u)
}

// A pause this long after the last words ends the listening, so the manager need not tap again.
const SILENCE_MS = 2500

export interface Listening {
  stop: () => void
}

/**
 * Listens until a pause or `stop()`. `onText` gets the words so far as they come; `onEnd` gets
 * the final words (maybe empty), or an error message.
 */
export function listen(onText: (text: string) => void, onEnd: (text: string, error?: string) => void): Listening | null {
  if (!Speech) return null
  audioSession('auto')
  const r = new Speech()
  r.lang = language().speech
  r.interimResults = true
  // iPhone's continuous listening is unreliable; it stops by itself after a pause instead.
  r.continuous = !isIOS
  let text = ''
  let error: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let ended = false
  let guard: ReturnType<typeof setTimeout> | undefined
  const finish = () => {
    if (ended) return
    ended = true
    clearTimeout(timer)
    clearTimeout(guard)
    onEnd(text, error)
  }
  // Some phones (iPhone) may never say "ended" after stop: then the words so far go on anyway.
  const stop = () => {
    try {
      r.stop()
    } catch {
      // already stopped
    }
    clearTimeout(guard)
    guard = setTimeout(finish, 1500)
  }
  const quietStop = () => {
    clearTimeout(timer)
    timer = setTimeout(stop, SILENCE_MS)
  }
  r.onresult = (e) => {
    const pieces: string[] = []
    for (let i = 0; i < e.results.length; i++) pieces.push(e.results[i][0].transcript)
    text = joinTranscripts(pieces)
    onText(text)
    quietStop()
  }
  r.onerror = (e) => {
    if (e.error !== 'aborted' && !(e.error === 'no-speech' && text)) error = LISTEN_ERRORS[e.error] ?? tx('זיהוי הדיבור לא הצליח. אפשר להקליד במקום.')
  }
  r.onend = finish
  r.start()
  timer = setTimeout(stop, 8000) // nothing said at all
  return { stop }
}

// The voice: the one the manager picked on this phone (assistant screen), else, in Hebrew, the first cloud
// voice, else the best-sounding one the phone has for the app's language (a male one first: the owner
// wants a man's voice, 2026-11-14). Voices may load a moment after the page, so the list is read each time.
const VOICE_KEY = 'assistant.voice'
const CLOUD = 'cloud:'

/** A voice to pick: one of Shali's cloud voices, or one of this phone's. */
export interface VoiceOption {
  id: string
  cloud?: CloudVoice
  device?: SpeechSynthesisVoice
}

const cloudOptions = (): VoiceOption[] => (language().code === 'he' ? CLOUD_VOICES.map((c) => ({ id: CLOUD + c, cloud: c })) : [])

/** The phone's voices for the app's language, best-sounding first. */
function deviceVoices(): SpeechSynthesisVoice[] {
  return canSpeak ? rankVoices(speechSynthesis.getVoices(), language().code) : []
}

/** Every voice to pick from: the cloud ones (Hebrew), then this phone's. */
export function voices(): VoiceOption[] {
  return [...cloudOptions(), ...deviceVoices().map((v) => ({ id: v.voiceURI, device: v }))]
}

function savedVoice(): string | null {
  try {
    return localStorage.getItem(VOICE_KEY)
  } catch {
    return null
  }
}

let picked: string | null = null

export function currentVoice(): VoiceOption | null {
  const list = voices()
  const id = picked ?? savedVoice()
  return list.find((v) => v.id === id) ?? list[0] ?? null
}

/** The next voice in the list (after the last, back to the first), saved for next time. */
export function nextVoice(): VoiceOption | null {
  const list = voices()
  if (!list.length) return null
  const i = list.findIndex((v) => v.id === currentVoice()?.id)
  const v = list[(i + 1) % list.length]
  try {
    localStorage.setItem(VOICE_KEY, v.id)
  } catch {
    // private mode: the voice holds until the page reloads
  }
  picked = v.id
  return v
}

export const voiceName = (v: VoiceOption | null) =>
  !v ? '' : v.cloud ? tx('ענן {n}', { n: CLOUD_VOICES.indexOf(v.cloud) + 1 }) : v.device ? shortVoiceName(v.device) : ''

/** The phone voice to fall back on: the picked one if it is the phone's, else its best. */
const deviceVoice = (): SpeechSynthesisVoice | null => currentVoice()?.device ?? deviceVoices()[0] ?? null

/** Calls `fn` when the phone's voices finish loading or change; returns a function to stop. */
export function onVoicesChanged(fn: () => void): () => void {
  if (!canSpeak) return () => {}
  speechSynthesis.addEventListener('voiceschanged', fn)
  return () => speechSynthesis.removeEventListener('voiceschanged', fn)
}

// How fast replies are read, chosen on the assistant screen and kept on this phone.
export const RATES = [
  { value: 0.8, name: tx('איטי') },
  { value: 1, name: tx('רגיל') },
  { value: 1.25, name: tx('מהיר') },
  { value: 1.5, name: tx('מהיר מאוד') },
] as const
const RATE_KEY = 'assistant.rate'
let current: number | undefined

export function speechRate(): number {
  try {
    const v = Number(localStorage.getItem(RATE_KEY))
    return RATES.some((r) => r.value === v) ? v : 1
  } catch {
    return 1
  }
}

/** The next rate in RATES (after the fastest, back to the slowest), saved for next time. */
export function nextRate(): number {
  const i = RATES.findIndex((r) => r.value === speechRate())
  const v = RATES[(i + 1) % RATES.length].value
  try {
    localStorage.setItem(RATE_KEY, String(v))
  } catch {
    // private mode: the rate holds until the page reloads
  }
  current = v
  return v
}
export const rateName = (v: number) => RATES.find((r) => r.value === v)?.name ?? tx('רגיל')

// Who wants to know what was said (new words go to "אימון הגייה", src/App.tsx).
const heard = new Set<(text: string) => void>()
/** Calls `fn` with each text read aloud; returns a function to stop. */
export function onSpoken(fn: (text: string) => void): () => void {
  heard.add(fn)
  return () => heard.delete(fn)
}

// The utterance being read. Chrome can drop an utterance nobody holds before it is read, and then
// nothing is heard; holding it here keeps it alive.
const alive = new Set<SpeechSynthesisUtterance>()

/**
 * Reads the text aloud in the app's language; `onDone` when it ends or cannot start. `onFail` gets the
 * browser's reason when the phone could not read it at all (not when another text cut it short).
 */
export function speak(text: string, onDone?: () => void, onFail?: (reason: string) => void) {
  // While the quick "one moment" is said, what comes next waits for it to end instead of cutting it off.
  if (holding) {
    prepare(text) // asked for now, so it is ready the moment "one moment" ends
    const mine = holdTurn
    holding.then(() => mine === holdTurn && speak(text, onDone, onFail))
    return
  }
  const cloud = currentVoice()?.cloud
  const useCloud = Boolean(cloud) && !cloudOff()
  if ((!canSpeak && !useCloud) || !text) {
    onDone?.()
    return
  }
  heard.forEach((fn) => fn(text))
  audioSession('playback')
  const said = pronounce(speakable(text, language().speech))
  if (useCloud && cloud) {
    if (canSpeak) speechSynthesis.cancel()
    return speakCloud(said, cloud, current ?? (current = speechRate()), () => onDone?.(), (rest) => (canSpeak ? speakDevice(rest, onDone, onFail) : onDone?.()))
  }
  stopCloud()
  speakDevice(said, onDone, onFail)
}

/** The phone's own voice reads the text, already made speakable. */
function speakDevice(said: string, onDone?: () => void, onFail?: (reason: string) => void) {
  const start = (withVoice: boolean) => {
    const u = new SpeechSynthesisUtterance(said)
    u.lang = language().speech
    u.rate = current ?? (current = speechRate())
    const v = withVoice ? deviceVoice() : null
    if (v) {
      u.voice = v
      u.lang = v.lang
    }
    u.onend = () => {
      alive.delete(u)
      onDone?.()
    }
    u.onerror = (e) => {
      alive.delete(u)
      if (e.error === 'interrupted' || e.error === 'canceled') return onDone?.()
      // Some voices refuse a text (often one in English letters): try once more with the phone's own.
      if (v) return start(false)
      onFail?.(e.error)
      onDone?.()
    }
    alive.add(u)
    speechSynthesis.resume() // Chrome sometimes leaves the speech paused after a while of quiet
    speechSynthesis.speak(u)
  }
  // Speaking right after cancelling is sometimes silently dropped (Chrome on Android): wait a moment.
  if (speechSynthesis.speaking || speechSynthesis.pending) {
    speechSynthesis.cancel()
    setTimeout(() => start(true), 150)
  } else start(true)
}

// The quick "one moment" said the moment the manager stops talking, while the answer is on its way
// (owner, 2026-11-14: the cloud voice made Shali feel slow). Prepared ahead, so it starts at once.
let holding: Promise<void> | null = null
let holdTurn = 0

/** Gets a phrase ready in the cloud voice, so `speakAtOnce` can say it with no wait. */
export function prepare(text: string) {
  const cloud = currentVoice()?.cloud
  if (cloud && !cloudOff()) prefetchCloud(pronounce(speakable(text, language().speech)), cloud, current ?? (current = speechRate()))
}

/** Says a short prepared phrase now; anything spoken meanwhile waits for it (at most 3 s). */
export function speakAtOnce(text: string) {
  holding = null
  const mine = ++holdTurn
  let release = () => {}
  const p = new Promise<void>((done) => (release = done))
  const end = () => {
    if (mine !== holdTurn) return
    holding = null
    release()
  }
  speak(text, end)
  holding = p
  setTimeout(end, 3000)
}

export const stopSpeaking = () => {
  holding = null
  holdTurn++
  stopCloud()
  if (canSpeak) speechSynthesis.cancel()
}
