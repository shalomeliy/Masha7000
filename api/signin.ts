import { router } from './_lib/router.js'
import * as callback from './_lib/routes/auth-callback.js'
import * as start from './_lib/routes/auth-start.js'
import * as logout from './_lib/routes/logout.js'
import * as mfa from './_lib/routes/mfa.js'
import * as token from './_lib/routes/token.js'

// Sign-in area in one function file (see api/_lib/router.ts): /api/auth/start, /api/auth/callback,
// /api/token, /api/logout, /api/mfa. vercel.json maps each URL here.
export const routes = { 'auth-start': start, 'auth-callback': callback, token, logout, mfa }
export const { GET, POST } = router(routes)
