import { router } from './_lib/router.js'
import * as constraints from './_lib/routes/constraints.js'
import * as join from './_lib/routes/join.js'

// Public worker forms in one function file (see api/_lib/router.ts): /api/join, /api/constraints.
// vercel.json maps each URL here.
export const routes = { join, constraints }
export const { GET, POST } = router(routes)
