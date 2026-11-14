import { language, tx } from '../i18n'
import { joinTranscripts } from './dictation'
import { CLOUD_VOICES, cloudOff, speakCloud, stopCloud, type CloudVoice } from './cloudVoice'
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

export const canListen = Boolean(Speech)
export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window

export const LISTEN_ERRORS: Record<string, string> = {
  'not-allowed': tx('אין הרשאה למיקרופון. אפשר לאשר אותה בהגדרות הדפדפן.'),
  'service-not-allowed': tx('אין הרשאה למיקרופון. אפשר לאשר אותה בהגדרות הדפדפן.'),
  network: tx('זיהוי הדיבור צריך אינטרנט.'),
  'no-speech': tx('לא נשמע דיבור. נסה שוב.'),
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
  const r = new Speech()
  r.lang = language().speech
  r.interimResults = true
  r.continuous = true
  let text = ''
  let error: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const quietStop = () => {
    clearTimeout(timer)
    timer = setTimeout(() => r.stop(), SILENCE_MS)
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
  r.onend = () => {
    clearTimeout(timer)
    onEnd(text, error)
  }
  r.start()
  timer = setTimeout(() => r.stop(), 8000) // nothing said at all
  return { stop: () => r.stop() }
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
  const cloud = currentVoice()?.cloud
  const useCloud = Boolean(cloud) && !cloudOff()
  if ((!canSpeak && !useCloud) || !text) {
    onDone?.()
    return
  }
  heard.forEach((fn) => fn(text))
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

export const stopSpeaking = () => {
  stopCloud()
  if (canSpeak) speechSynthesis.cancel()
}
