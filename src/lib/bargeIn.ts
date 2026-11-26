import { vlog } from './voiceLog'

// Cutting Shali off by voice (the owner, 2026-11-27, an experiment after the real-time voice review of
// 2026-11-26, https://claude.ai/artifact/BuTRtzCnsy8hEiBR1bTCka): while Shali speaks, the microphone listens for the
// manager's voice; when he talks over Shali, Shali stops and listens. Off by default, per phone
// (Settings > העוזר הקולי). Shali's own voice must not count as the manager: the browser's echo
// cancellation removes most of it, and the bar is set from what the mic hears in the first moments
// of Shali speaking, so what is left of Shali's voice stays under it.
// Not on iPhone: an open microphone there turns the sound to "call" mode, quiet (speech.ts audioSession).

const KEY = 'assistant.bargeIn'
const STEP_MS = 50 // one level reading
const CALIBRATE = 6 // the first readings (300 ms) set the bar: Shali's voice as the mic hears it
const LOUD_STEPS = 6 // this many loud readings in a row (300 ms) is the manager talking
const MIN_LOUD = 0.03 // speech is at least this loud, however quiet Shali sounds in the mic
const OVER = 2.5 // and this many times louder than what the mic heard of Shali

/** True where the microphone can be measured while Shali speaks (not on iPhone). */
export function canBargeIn(ios: boolean): boolean {
  return !ios && typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof AudioContext !== 'undefined'
}

export function bargeInOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setBargeIn(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    // private mode: the switch just does not stay
  }
}

/** Reads levels one by one; true once the manager's voice is heard over Shali's. */
export function detector(): (level: number) => boolean {
  const first: number[] = []
  let bar = MIN_LOUD
  let loud = 0
  return (level) => {
    if (first.length < CALIBRATE) {
      first.push(level)
      if (first.length === CALIBRATE) bar = Math.max(MIN_LOUD, Math.max(...first) * OVER)
      return false
    }
    loud = level >= bar ? loud + 1 : 0
    return loud >= LOUD_STEPS
  }
}

/**
 * Listens while Shali speaks; calls `onVoice` once, after letting go of the microphone (so listening
 * can take it at once), when the manager talks over Shali. Returns a function that stops it.
 */
export function watchBargeIn(onVoice: () => void): () => void {
  let stopped = false
  let stream: MediaStream | null = null
  let ctx: AudioContext | null = null
  let timer: ReturnType<typeof setInterval> | undefined
  const stop = () => {
    stopped = true
    clearInterval(timer)
    stream?.getTracks().forEach((t) => t.stop())
    void ctx?.close().catch(() => {})
    stream = null
    ctx = null
  }
  navigator.mediaDevices
    .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } })
    .then((s) => {
      if (stopped) return s.getTracks().forEach((t) => t.stop())
      stream = s
      ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      ctx.createMediaStreamSource(s).connect(analyser)
      const buf = new Float32Array(analyser.fftSize)
      const heard = detector()
      vlog('barge-in: listening')
      timer = setInterval(() => {
        analyser.getFloatTimeDomainData(buf)
        let sum = 0
        for (const v of buf) sum += v * v
        if (!heard(Math.sqrt(sum / buf.length))) return
        vlog('barge-in: voice over Shali')
        stop()
        onVoice()
      }, STEP_MS)
    })
    .catch((e: Error) => vlog(`barge-in: no mic (${e.name})`))
  return stop
}
