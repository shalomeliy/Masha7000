import type { Env } from './env.js'
import { KEYS, kv } from './kv.js'

// Fixed-window counters in the store: at most `max` tries per `windowSeconds` for one bucket and one
// caller (an address or an email). Slows down guessing a two-step code, flooding the public workers'
// form, or hammering sign-in.

export interface Limit {
  max: number
  windowSeconds: number
}

export const LIMITS = {
  signIn: { max: 30, windowSeconds: 600 },
  token: { max: 300, windowSeconds: 600 },
  owner: { max: 120, windowSeconds: 600 },
  mfaIp: { max: 30, windowSeconds: 900 },
  mfaEmail: { max: 8, windowSeconds: 900 },
  mfaEmailDay: { max: 30, windowSeconds: 86_400 },
  joinRead: { max: 120, windowSeconds: 600 },
  joinSubmit: { max: 15, windowSeconds: 3600 },
  joinManage: { max: 200, windowSeconds: 600 },
} satisfies Record<string, Limit>

/** Counts this try; true when the caller is over the limit. */
export async function overLimit(env: Env, bucket: keyof typeof LIMITS, id: string): Promise<boolean> {
  const { max, windowSeconds } = LIMITS[bucket]
  // The window's number is in the key, so a counter that somehow kept no expiry stops counting anyway.
  const window = Math.floor(Date.now() / 1000 / windowSeconds)
  const key = KEYS.rate(bucket, `${id.toLowerCase().slice(0, 200)}:${window}`)
  const n = await kv.incr(env, key)
  if (n === 1) await kv.expire(env, key, windowSeconds + 60)
  return n > max
}
