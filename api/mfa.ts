import { audit } from './_lib/audit.js'
import { open, previousKey, seal, sha256url } from './_lib/crypto.js'
import { readEnv, type Env } from './_lib/env.js'
import { clearCookie, clientIp, guarded, json, readJson, sameOrigin, SESSION_COOKIE } from './_lib/http.js'
import { KEYS, kv } from './_lib/kv.js'
import { overLimit } from './_lib/rate.js'
import { endAllSessions, isAllowed, isOwner, markVerified, normalizeEmail, readSession, requireManager, type Session } from './_lib/session.js'
import { base32, fromBase32, matchStep, otpauthUri } from './_lib/totp.js'

// POST /api/mfa { action }: two-step sign-in. After Google says who you are, an authenticator app on
// your phone gives a 6-digit code that changes every 30 seconds; this device works only after one is typed.
//
// Before a code (signed in with Google, allowed, not verified yet):
//   'setup'   a new secret for the app (15 minutes to confirm). Once set up, only a verified device may set up again.
//   'enable'  { code }  confirms the app works: saves it, verifies this device, gives 10 one-time backup codes.
//   'verify'  { code }  a code from the app, or one backup code (each works once).
// Verified only:
//   'status'  how many backup codes are left.     'codes'  10 new backup codes (the old ones stop working).
//   'logout-all'  signs this person out on every device, this one too.
//   'reset' { email }  owner only: a manager who lost the phone sets the app up again at the next sign-in.

interface Secret {
  secret: string
  usedStep: number
  recovery: string[]
}

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O, 1/I
const RECOVERY_COUNT = 10

const recoveryHash = (env: Env, code: string, key = env.sessionKey) => sha256url(`${key}|rc|${code.toUpperCase().replace(/[\s-]/g, '')}`)

async function newRecovery(env: Env) {
  const codes = Array.from({ length: RECOVERY_COUNT }, () => {
    const bytes = crypto.getRandomValues(new Uint8Array(8))
    const c = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('')
    return `${c.slice(0, 4)}-${c.slice(4)}`
  })
  return { codes, hashes: await Promise.all(codes.map((c) => recoveryHash(env, c))) }
}

const readSecret = async (env: Env, email: string) => open<Secret>(env.sessionKey, await kv.get(env, KEYS.mfa(email)))
const saveSecret = async (env: Env, email: string, s: Secret) => kv.set(env, KEYS.mfa(email), await seal(env.sessionKey, s))

const tooMany = () => json({ reason: 'too-many' }, 429)

/** Counts a code try for this address and this email. */
const codeTryRefused = async (env: Env, req: Request, email: string) =>
  (await overLimit(env, 'mfaIp', clientIp(req))) || (await overLimit(env, 'mfaEmail', email)) || (await overLimit(env, 'mfaEmailDay', email))

export const POST = guarded(async (req: Request) => {
  const env = readEnv()
  if (!env) return json({ reason: 'not-configured' }, 503)
  if (!sameOrigin(req, env.appOrigin)) return json({ reason: 'bad-origin' }, 403)
  const body = await readJson(req)
  if (!body) return json({ reason: 'bad-body' }, 400)
  const code = typeof body.code === 'string' ? body.code.slice(0, 20) : ''

  if (body.action === 'setup' || body.action === 'enable' || body.action === 'verify') {
    const session = await readSession(env, req)
    if (!session) return json({ reason: 'no-session' }, 401)
    if (!(await isAllowed(env, session.email))) return json({ reason: 'not-allowed' }, 403)
    if (body.action === 'setup') return setup(env, req, session)
    if (await codeTryRefused(env, req, session.email)) {
      await audit(env, req, 'mfa-locked', { email: session.email })
      return tooMany()
    }
    const answer = body.action === 'enable' ? await enable(env, session, code) : await verify(env, session, code)
    if (answer.status === 400) await audit(env, req, 'mfa-wrong', { email: session.email })
    else if (answer.ok) await audit(env, req, body.action === 'enable' ? 'mfa-enrolled' : answer.headers.get('x-recovery') ? 'recovery-used' : 'mfa-ok', { email: session.email })
    answer.headers.delete('x-recovery')
    return answer
  }

  const gate = await requireManager(env, req)
  if ('refuse' in gate) return gate.refuse
  const { session } = gate
  switch (body.action) {
    case 'status': {
      const s = await readSecret(env, session.email)
      return json({ enrolled: !!s, recoveryLeft: s?.recovery.length ?? 0 })
    }
    case 'codes': {
      const s = await readSecret(env, session.email)
      if (!s) return json({ reason: 'not-enrolled' }, 409)
      const { codes, hashes } = await newRecovery(env)
      await saveSecret(env, session.email, { ...s, recovery: hashes })
      await audit(env, req, 'recovery-new', { email: session.email })
      return json({ recoveryCodes: codes })
    }
    case 'logout-all':
      await endAllSessions(env, session.email)
      await audit(env, req, 'logout-all', { email: session.email })
      return json({ ok: true }, 200, [clearCookie(SESSION_COOKIE)])
    case 'reset': {
      if (!isOwner(env, session.email)) return json({ reason: 'not-owner' }, 403)
      const email = normalizeEmail(body.email)
      if (!email) return json({ reason: 'bad-email' }, 400)
      if (email === env.ownerEmail) return json({ reason: 'owner-self' }, 400)
      await kv.del(env, KEYS.mfa(email), KEYS.mfaSetup(email))
      await endAllSessions(env, email)
      await audit(env, req, 'mfa-reset', { email: session.email, target: email })
      return json({ ok: true })
    }
    default:
      return json({ reason: 'bad-action' }, 400)
  }
})

async function setup(env: Env, req: Request, session: Session) {
  if (await overLimit(env, 'mfaIp', clientIp(req))) return tooMany()
  // Someone who only has the Google password must not swap in their own phone.
  if (!session.mfa && (await readSecret(env, session.email))) return json({ reason: 'enrolled' }, 409)
  const secret = base32(crypto.getRandomValues(new Uint8Array(20)))
  await kv.set(env, KEYS.mfaSetup(session.email), await seal(env.sessionKey, { secret }), 900)
  return json({ secret, uri: otpauthUri(secret, session.email) })
}

async function enable(env: Env, session: Session, code: string) {
  if (!session.mfa && (await readSecret(env, session.email))) return json({ reason: 'enrolled' }, 409)
  const pending = await open<{ secret: string }>(env.sessionKey, await kv.get(env, KEYS.mfaSetup(session.email)))
  if (!pending) return json({ reason: 'setup-expired' }, 409)
  const step = await matchStep(fromBase32(pending.secret), code)
  if (step === null || !(await kv.claim(env, KEYS.mfaUsed(session.email, `s${step}`), 120))) return json({ reason: 'wrong-code' }, 400)
  const { codes, hashes } = await newRecovery(env)
  await saveSecret(env, session.email, { secret: pending.secret, usedStep: step, recovery: hashes })
  await kv.del(env, KEYS.mfaSetup(session.email))
  await markVerified(env, session)
  // A new phone: every other device signs in again with it.
  await endAllSessions(env, session.email, session.sid)
  return json({ ok: true, recoveryCodes: codes })
}

async function verify(env: Env, session: Session, code: string) {
  const s = await readSecret(env, session.email)
  if (!s) return json({ reason: 'not-enrolled' }, 409)
  const step = await matchStep(fromBase32(s.secret), code, s.usedStep)
  // Claimed atomically: two requests racing with the same code, only one gets in.
  if (step !== null) {
    if (!(await kv.claim(env, KEYS.mfaUsed(session.email, `s${step}`), 120))) return json({ reason: 'wrong-code' }, 400)
    await saveSecret(env, session.email, { ...s, usedStep: step })
  } else {
    // While SESSION_KEY is being replaced, codes given out under the old key still work.
    const old = previousKey()
    const hashes = [await recoveryHash(env, code), ...(old ? [await recoveryHash(env, code, old)] : [])]
    const hash = hashes.find((h) => s.recovery.includes(h))
    if (code.length < 8 || !hash) return json({ reason: 'wrong-code' }, 400)
    if (!(await kv.claim(env, KEYS.mfaUsed(session.email, hash), 400 * 86_400))) return json({ reason: 'wrong-code' }, 400)
    const latest = (await readSecret(env, session.email)) ?? s
    await saveSecret(env, session.email, { ...latest, recovery: latest.recovery.filter((h) => h !== hash) })
  }
  await markVerified(env, session)
  const done = json({ ok: true, recoveryLeft: step !== null ? s.recovery.length : s.recovery.length - 1 })
  if (step === null) done.headers.set('x-recovery', '1') // for the security log only; removed before it is sent
  return done
}

