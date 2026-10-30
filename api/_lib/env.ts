// Server settings, from Vercel env vars (Production only). Missing any: the server is "not configured"
// and the app keeps using its browser-only sign-in, so nothing breaks before setup.

export interface Env {
  clientId: string
  clientSecret: string
  sessionKey: string
  ownerEmail: string
  kvUrl: string
  kvToken: string
  appOrigin: string
}

// The Upstash integration may add a prefix the owner chose (e.g. STORAGE_KV_REST_API_URL).
const bySuffix = (e: NodeJS.ProcessEnv, ...suffixes: string[]) => {
  for (const s of suffixes) if (e[s]) return e[s]!
  const key = Object.keys(e).find((k) => suffixes.some((s) => k.endsWith(`_${s}`)) && e[k])
  return key ? e[key]! : ''
}

function collect(e: NodeJS.ProcessEnv) {
  return {
    clientId: (e.VITE_GOOGLE_CLIENT_ID ?? '').trim(),
    clientSecret: (e.GOOGLE_CLIENT_SECRET ?? '').trim(),
    sessionKey: (e.SESSION_KEY ?? '').trim(),
    ownerEmail: (e.OWNER_EMAIL ?? '').trim().toLowerCase(),
    kvUrl: bySuffix(e, 'KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL'),
    kvToken: bySuffix(e, 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN'),
    appOrigin: e.APP_ORIGIN ?? 'https://masha7000.vercel.app',
  }
}

export function readEnv(e: NodeJS.ProcessEnv = process.env): Env | null {
  const env = collect(e)
  return Object.values(env).every(Boolean) ? env : null
}

const NAMES: Record<keyof Env, string> = {
  clientId: 'VITE_GOOGLE_CLIENT_ID',
  clientSecret: 'GOOGLE_CLIENT_SECRET',
  sessionKey: 'SESSION_KEY',
  ownerEmail: 'OWNER_EMAIL',
  kvUrl: 'KV_REST_API_URL',
  kvToken: 'KV_REST_API_TOKEN',
  appOrigin: 'APP_ORIGIN',
}

/** Names (never values) of the settings still missing, to help the owner finish setup. */
export function missingEnv(e: NodeJS.ProcessEnv = process.env): string[] {
  const env = collect(e)
  return (Object.keys(env) as (keyof Env)[]).filter((k) => !env[k]).map((k) => NAMES[k])
}

export const callbackUrl = (env: Env) => `${env.appOrigin}/api/auth/callback`
