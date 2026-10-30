// AES-256-GCM for everything the server hands out or stores: session cookies, the sign-in state
// cookie and the owner's Google tokens. A changed or foreign value opens to null.
// The "v1." prefix is the key version: a new SESSION_KEY makes every old value unreadable.

const VERSION = 'v1.'

async function importKey(keyB64: string) {
  const raw = Buffer.from(keyB64, 'base64')
  if (raw.length !== 32) throw new Error('SESSION_KEY must be 32 bytes, base64')
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function seal(keyB64: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(JSON.stringify(value))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importKey(keyB64), data))
  return VERSION + Buffer.concat([iv, sealed]).toString('base64url')
}

export async function open<T>(keyB64: string, text: string | null | undefined): Promise<T | null> {
  if (!text?.startsWith(VERSION)) return null
  try {
    const bytes = Buffer.from(text.slice(VERSION.length), 'base64url')
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(0, 12) },
      await importKey(keyB64),
      bytes.subarray(12),
    )
    return JSON.parse(new TextDecoder().decode(plain)) as T
  } catch {
    return null
  }
}

export const randomToken = (bytes = 32) => Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url')

export async function sha256url(text: string) {
  return Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).toString('base64url')
}
