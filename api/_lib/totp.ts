// Time-based one-time codes (RFC 6238), the 6 digits an authenticator app (Google Authenticator,
// Microsoft Authenticator...) shows and changes every 30 seconds. HMAC-SHA1, as every app expects.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export const STEP_SECONDS = 30

export function base32(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function fromBase32(text: string): Uint8Array<ArrayBuffer> {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch)
    if (i < 0) throw new Error('bad base32')
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS)

export async function codeAt(secret: Uint8Array<ArrayBuffer>, step: number, digits = 6): Promise<string> {
  const counter = new Uint8Array(8)
  new DataView(counter.buffer).setBigUint64(0, BigInt(step))
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter))
  const at = mac[mac.length - 1] & 15
  const n = ((mac[at] & 127) << 24) | (mac[at + 1] << 16) | (mac[at + 2] << 8) | mac[at + 3]
  return String(n % 10 ** digits).padStart(digits, '0')
}

/**
 * The step a typed code belongs to (now, or one step either side for a slow phone clock),
 * or null. A step at or before `usedStep` is refused, so one code works only once.
 */
export async function matchStep(secret: Uint8Array<ArrayBuffer>, code: string, usedStep = -1, now = Date.now()): Promise<number | null> {
  const typed = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(typed)) return null
  const step = currentStep(now)
  for (const s of [step, step - 1, step + 1]) {
    if (s > usedStep && (await codeAt(secret, s)) === typed) return s
  }
  return null
}

export const otpauthUri = (secretB32: string, account: string, issuer = 'ShiftSmart') =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`
