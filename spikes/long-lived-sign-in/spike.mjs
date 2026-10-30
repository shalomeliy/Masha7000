// Throwaway spike: can a server keep the owner's Google refresh token and hand out
// access tokens later, while other people sign in only to prove their email?
// Run: node spikes/long-lived-sign-in/spike.mjs  then open http://localhost:5190
// Needs in .env.local: VITE_GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET,
// and http://localhost:5190/callback as an Authorized redirect URI on the OAuth client.
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { randomBytes, createHash } from 'node:crypto'

const env = Object.fromEntries(
  readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^\w+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
)
const CLIENT_ID = env.VITE_GOOGLE_CLIENT_ID
const SECRET = env.GOOGLE_CLIENT_SECRET
const REDIRECT = 'http://localhost:5190/callback'
const STORE = new URL('./.tokens.local', import.meta.url) // gitignored (*.local)
const OWNER_SCOPES = 'openid email https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/calendar.app.created'
const pending = new Map() // state -> { verifier, kind }

const b64url = (buf) => buf.toString('base64url')
const page = (body) => `<!doctype html><meta charset="utf-8"><body style="font:16px sans-serif;direction:rtl;padding:24px">${body}<p><a href="/">חזרה</a></p>`

function authUrl(kind) {
  const state = b64url(randomBytes(16))
  const verifier = b64url(randomBytes(32))
  pending.set(state, { verifier, kind })
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: 'code',
    state,
    code_challenge: b64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
    ...(kind === 'owner'
      ? { scope: OWNER_SCOPES, access_type: 'offline', prompt: 'consent' }
      : { scope: 'openid email', prompt: 'select_account' }),
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`
}

const emailOf = (idToken) => JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url')).email

async function tokenCall(params) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: SECRET, ...params }),
  })
  return { ok: res.ok, data: await res.json() }
}

async function handle(req) {
  const url = new URL(req.url, 'http://localhost:5190')
  if (url.pathname === '/') {
    const saved = existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : null
    return page(`<h2>ניסוי: התחברות קבועה ונתונים משותפים</h2>
      <p>מצב: ${saved ? `נשמר מפתח של ${saved.email} (${saved.savedAt})` : 'עוד אין מפתח שמור'}</p>
      <ol>
        <li><a href="${authUrl('owner')}">התחברות המנהל (פעם אחת)</a></li>
        <li><a href="/refresh">חידוש בלי משתמש וקריאה מהדרייב של המנהל</a></li>
        <li><a href="${authUrl('identity')}">התחברות של מייל נוסף (רק זיהוי)</a></li>
      </ol>`)
  }
  if (url.pathname === '/callback') {
    const p = pending.get(url.searchParams.get('state'))
    if (!p) return page('state לא תקין: נדחה (כמו שצריך)')
    pending.delete(url.searchParams.get('state'))
    if (url.searchParams.get('error')) return page(`גוגל סירב: ${url.searchParams.get('error')}`)
    const { ok, data } = await tokenCall({ code: url.searchParams.get('code'), code_verifier: p.verifier, grant_type: 'authorization_code', redirect_uri: REDIRECT })
    if (!ok) return page(`החלפת הקוד נכשלה: ${data.error} ${data.error_description ?? ''}`)
    const email = emailOf(data.id_token)
    if (p.kind === 'identity') {
      console.log('IDENTITY', email, 'scopes:', data.scope, 'refresh token:', Boolean(data.refresh_token))
      return page(`זוהה: <b>${email}</b>. הרשאות: ${data.scope}`)
    }
    console.log('OWNER', email, 'refresh token:', Boolean(data.refresh_token), 'scopes:', data.scope)
    if (!data.refresh_token) return page('לא התקבל refresh token. זה הסיכון שבודקים.')
    writeFileSync(STORE, JSON.stringify({ email, refresh: data.refresh_token, savedAt: new Date().toISOString() }))
    return page(`התקבל ונשמר מפתח קבוע של <b>${email}</b>.`)
  }
  if (url.pathname === '/refresh') {
    if (!existsSync(STORE)) return page('אין מפתח שמור. קודם שלב 1.')
    const saved = JSON.parse(readFileSync(STORE, 'utf8'))
    const { ok, data } = await tokenCall({ refresh_token: saved.refresh, grant_type: 'refresh_token' })
    if (!ok) return page(`החידוש נכשל: ${data.error} ${data.error_description ?? ''}`)
    const files = await fetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(name,size)', {
      headers: { Authorization: `Bearer ${data.access_token}` },
    }).then((r) => r.json())
    console.log('REFRESH ok, expires_in', data.expires_in, 'files', files.files?.length)
    const list = (files.files ?? []).map((f) => `<li>${f.name} (${f.size} בתים)</li>`).join('')
    return page(`חידוש הצליח, תוקף ${data.expires_in} שניות. נמצאו ${files.files?.length ?? 0} קבצים בדרייב של ${saved.email}:<ul>${list}</ul>`)
  }
  return page('לא נמצא')
}

if (!CLIENT_ID || !SECRET) {
  console.error('Missing VITE_GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env.local')
  process.exit(1)
}
createServer(async (req, res) => {
  try {
    const html = await handle(req)
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(html)
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(String(e))
  }
}).listen(5190, () => console.log('Spike on http://localhost:5190'))
