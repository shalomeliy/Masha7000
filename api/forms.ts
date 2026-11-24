import { router } from './_lib/router.js'
import * as access from './_lib/routes/access.js'
import * as constraints from './_lib/routes/constraints.js'
import * as join from './_lib/routes/join.js'

// Public forms in one function file (see api/_lib/router.ts): /api/join, /api/constraints, and the
// new customer's access request /api/access.
// vercel.json maps each URL here.
export const routes = { join, constraints, access }
export const { GET, POST } = router(routes)
