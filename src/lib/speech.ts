import { language, tx } from '../i18n'
import { joinTranscripts } from './dictation'
import { pronounce } from './pronounce'
import { rankVoices, shortVoiceName, speakable } from './speakable'

// Speech in and out in the app's language, for the voice assistant. In: the browser's speech recognition,
// as in DictationField. Out: the browser's speech synthesis, free and on the phone itself.

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

// The voice: the one the manager picked on this phone (assistant screen), else the best-sounding one
// the phone has for the app's language. Voices may load a moment after the page, so the list is read
// each time rather than kept.
const VOICE_KEY = 'assistant.voice'

/** This phone's voices for the app's language, best-sounding first. */
export function voices(): SpeechSynthesisVoice[] {
  return canSpeak ? rankVoices(speechSynthesis.getVoices(), language().code) : []
}

function savedVoice(): string | null {
  try {
    return localStorage.getItem(VOICE_KEY)
  } catch {
    return null
  }
}

let picked: SpeechSynthesisVoice | null = null

export function currentVoice(): SpeechSynthesisVoice | null {
  const list = voices()
  const id = picked?.voiceURI ?? savedVoice()
  return list.find((v) => v.voiceURI === id) ?? list[0] ?? null
}

/** The next voice in the list (after the last, back to the first), saved for next time. */
export function nextVoice(): SpeechSynthesisVoice | null {
  const list = voices()
  if (!list.length) return null
  const i = list.findIndex((v) => v.voiceURI === currentVoice()?.voiceURI)
  const v = list[(i + 1) % list.length]
  try {
    localStorage.setItem(VOICE_KEY, v.voiceURI)
  } catch {
    // private mode: the voice holds until the page reloads
  }
  picked = v
  return v
}

export const voiceName = (v: SpeechSynthesisVoice | null) => (v ? shortVoiceName(v) : '')

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

/** Reads the text aloud in the app's language; `onDone` when it ends or cannot start. */
export function speak(text: string, onDone?: () => void) {
  if (!canSpeak || !text) {
    onDone?.()
    return
  }
  speechSynthesis.cancel()
  heard.forEach((fn) => fn(text))
  const u = new SpeechSynthesisUtterance(pronounce(speakable(text, language().speech)))
  u.lang = language().speech
  u.rate = current ?? (current = speechRate())
  const v = currentVoice()
  if (v) {
    u.voice = v
    u.lang = v.lang
  }
  u.onend = () => onDone?.()
  u.onerror = () => onDone?.()
  speechSynthesis.speak(u)
}

export const stopSpeaking = () => canSpeak && speechSynthesis.cancel()
