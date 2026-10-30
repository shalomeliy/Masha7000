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

export function readEnv(e: NodeJS.ProcessEnv = process.env): Env | null {
  const env = {
    clientId: e.VITE_GOOGLE_CLIENT_ID ?? '',
    clientSecret: e.GOOGLE_CLIENT_SECRET ?? '',
    sessionKey: e.SESSION_KEY ?? '',
    ownerEmail: (e.OWNER_EMAIL ?? '').trim().toLowerCase(),
    kvUrl: e.KV_REST_API_URL ?? e.UPSTASH_REDIS_REST_URL ?? '',
    kvToken: e.KV_REST_API_TOKEN ?? e.UPSTASH_REDIS_REST_TOKEN ?? '',
    appOrigin: e.APP_ORIGIN ?? 'https://masha7000.vercel.app',
  }
  return Object.values(env).every(Boolean) ? env : null
}

export const callbackUrl = (env: Env) => `${env.appOrigin}/api/auth/callback`
