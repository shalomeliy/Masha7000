// Raw sound from the microphone as a 16 kHz mono 16-bit WAV, the format the server's speech to text takes
// (api/_lib/stt.ts). Not the iPhone recorder's own audio/mp4: that is AAC, which Google's v1 does not take.

export const WAV_RATE = 16_000

/** The pieces heard at `fromRate`, joined, brought down to 16 kHz and written as a WAV file. */
export function toWav(parts: Float32Array[], fromRate: number): Blob {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const all = new Float32Array(total)
  let at = 0
  for (const p of parts) {
    all.set(p, at)
    at += p.length
  }
  const step = fromRate / WAV_RATE
  const n = Math.floor(total / step)
  const out = new DataView(new ArrayBuffer(44 + n * 2))
  const text = (o: number, t: string) => [...t].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  out.setUint32(4, 36 + n * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  out.setUint32(16, 16, true)
  out.setUint16(20, 1, true)
  out.setUint16(22, 1, true)
  out.setUint32(24, WAV_RATE, true)
  out.setUint32(28, WAV_RATE * 2, true)
  out.setUint16(32, 2, true)
  out.setUint16(34, 16, true)
  text(36, 'data')
  out.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) {
    // The average of the samples this one stands for: a simple low-pass before dropping the rate.
    const from = Math.floor(i * step)
    const to = Math.max(from + 1, Math.floor((i + 1) * step))
    let sum = 0
    for (let j = from; j < to; j++) sum += all[j] ?? 0
    const v = Math.max(-1, Math.min(1, sum / (to - from)))
    out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true)
  }
  return new Blob([out.buffer], { type: 'audio/wav' })
}

export async function blobBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** The loudness of a piece of sound (root mean square), 0..1. */
export function level(piece: Float32Array): number {
  let sum = 0
  for (const v of piece) sum += v * v
  return piece.length ? Math.sqrt(sum / piece.length) : 0
}
