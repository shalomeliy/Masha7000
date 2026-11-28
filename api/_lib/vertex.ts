import { createSign } from 'node:crypto'

// Shali's voice through Google's EU endpoint on Vertex AI (owner's hosting decision, 2026-11-28: shifts and
// storage in Israel, AI processed in Europe; spikes/vertex-eu, plan docs/specs/israel-hosting-migration-PLAN.md
// stage 2). Signs in with a service account (VERTEX_SA_KEY = the key's JSON, role Vertex AI User only) and calls
// Gemini TTS at aiplatform.eu.rep.googleapis.com. Off unless VERTEX_SA_KEY is set; any failure falls back to the
// AI Studio key / Chirp exactly as before.

export interface VertexConfig {
  project: string
  clientEmail: string
  privateKey: string
}

export function vertexConfig(e: NodeJS.ProcessEnv = process.env): VertexConfig | null {
  const raw = (e.VERTEX_SA_KEY ?? '').trim()
  if (!raw) return null
  try {
    const j = JSON.parse(raw) as { client_email?: string; private_key?: string; project_id?: string }
    const project = (e.VERTEX_PROJECT ?? j.project_id ?? '').trim()
    if (!j.client_email || !j.private_key || !project) return null
    return { project, clientEmail: j.client_email, privateKey: j.private_key }
  } catch {
    return null
  }
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url')

let cached: { token: string; until: number; who: string } | null = null

/** An OAuth access token for the service account (kept ~50 minutes in memory). */
export async function vertexToken(cfg: VertexConfig, fetchFn: typeof fetch = fetch, now = Date.now()): Promise<string> {
  if (cached && cached.who === cfg.clientEmail && cached.until > now) return cached.token
  const iat = Math.floor(now / 1000)
  const claim = { iss: cfg.clientEmail, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }
  const unsigned = `${b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64u(JSON.stringify(claim))}`
  const sig = createSign('RSA-SHA256').update(unsigned).sign(cfg.privateKey).toString('base64url')
  const res = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`vertex token ${res.status}`)
  const { access_token } = (await res.json()) as { access_token?: string }
  if (!access_token) throw new Error('vertex token empty')
  cached = { token: access_token, until: now + 50 * 60_000, who: cfg.clientEmail }
  return access_token
}

const isWav = (b: Uint8Array) => b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF'

/** Gemini 3.8 Flash-Lite TTS on Vertex, EU multi-region. Returns WAV (PCM wrapped when the reply is bare). */
export async function vertexSpeak(
  text: string,
  voice: string,
  cfg: VertexConfig,
  wrapPcm: (pcm: Uint8Array) => Uint8Array,
  fetchFn: typeof fetch = fetch,
  ms = 15_000,
): Promise<{ bytes: Uint8Array; engine: string }> {
  const started = Date.now()
  const token = await vertexToken(cfg, fetchFn)
  const model = 'gemini-3.8-flash-lite-tts'
  const url = `https://aiplatform.eu.rep.googleapis.com/v1/projects/${encodeURIComponent(cfg.project)}/locations/eu/publishers/google/models/${model}:generateContent`
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': cfg.project },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    }),
    signal: AbortSignal.timeout(Math.max(1000, ms - (Date.now() - started))),
  })
  if (!res.ok) throw new Error(`vertex tts ${res.status} ${(await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)}`)
  const data = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[] }
  const b64 = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data
  if (!b64) throw new Error('vertex tts empty')
  const raw = new Uint8Array(Buffer.from(b64, 'base64'))
  return { bytes: isWav(raw) ? raw : wrapPcm(raw), engine: `${model} ${voice} (eu)` }
}
