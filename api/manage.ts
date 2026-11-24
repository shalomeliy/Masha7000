import { router } from './_lib/router.js'
import * as claudeLog from './_lib/routes/claude-log.js'
import * as feedback from './_lib/routes/feedback.js'
import * as owner from './_lib/routes/owner.js'

// Owner controls, feature requests / fault reports and the Claude log in one function file
// (see api/_lib/router.ts): /api/owner, /api/feedback, /api/claude-log. vercel.json maps each URL here.
export const routes = { owner, feedback, 'claude-log': claudeLog }
export const { GET, POST, DELETE } = router(routes)
