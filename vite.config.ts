import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// Local only: /api/claude-log in memory, and /api/assistant with no sign-in checks (there is no sign-in server locally). By default it
// answers with a fixed stand-in (api/_lib/assistantMock.ts) and never calls Anthropic. Only when the
// owner turns on the switch on the assistant screen (header X-Dev-Real-Assistant, src/dev/realAssistant.ts)
// and .env.local has ANTHROPIC_API_KEY does it really ask Claude: that is the owner's own manual test
// and it is paid. Claude never turns it on (CLAUDE.md "Never spend the API key locally").
// Never part of the build.
function localAssistant(): Plugin {
  return {
    name: 'local-assistant',
    apply: 'serve',
    configureServer(server) {
      const env = loadEnv('development', process.cwd(), '')
      const key = (env.ANTHROPIC_API_KEY ?? '').trim()
      // The "what went to Claude" log: kept in memory while the dev server runs (on Vercel: the store).
      let log: { id: string }[] = []
      server.middlewares.use('/api/claude-log', async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method === 'GET') return res.end(JSON.stringify({ entries: log }))
        if (req.method === 'DELETE') {
          log = []
          return res.end(JSON.stringify({ ok: true }))
        }
        let raw = ''
        for await (const chunk of req) raw += chunk
        const entry = (JSON.parse(raw || '{}') as { entry?: { id: string } }).entry
        if (entry?.id) log = [...log.filter((x) => x.id !== entry.id), entry].slice(-300)
        return res.end(JSON.stringify({ ok: true }))
      })
      server.middlewares.use('/api/assistant', async (req, res) => {
        if (req.method === 'GET') {
          // The budget line on the screen: a made-up stand-in locally (the real count is on Vercel).
          const { mockBudget } = (await server.ssrLoadModule('/api/_lib/assistantMock.ts')) as typeof import('./api/_lib/assistantMock.ts')
          res.setHeader('Content-Type', 'application/json')
          return res.end(JSON.stringify({ budget: mockBudget() }))
        }
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          return res.end(JSON.stringify({ reason: 'bad-method' }))
        }
        let raw = ''
        for await (const chunk of req) raw += chunk
        const body = JSON.parse(raw || '{}') as { messages?: unknown; context?: unknown }
        const real = req.headers['x-dev-real-assistant'] === '1'
        if (real && !key) {
          res.statusCode = 503
          res.setHeader('Content-Type', 'application/json')
          return res.end(JSON.stringify({ reason: 'no-key' }))
        }
        let stream: ReadableStream<Uint8Array>
        if (real) {
          const { assistantStream } = (await server.ssrLoadModule('/api/_lib/assistant.ts')) as typeof import('./api/_lib/assistant.ts')
          stream = assistantStream(key, body.messages, body.context, env.ASSISTANT_MODEL, true)
        } else {
          const { mockAssistantStream } = (await server.ssrLoadModule('/api/_lib/assistantMock.ts')) as typeof import('./api/_lib/assistantMock.ts')
          stream = mockAssistantStream(body.messages)
        }
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
        const reader = stream.getReader()
        for (let r = await reader.read(); !r.done; r = await reader.read()) res.write(r.value)
        res.end()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), localAssistant()],
  // The commit Vercel builds, as the Sentry release, so an error can be traced back to its exact code (scripts/sentry-issues.mjs).
  define: { 'import.meta.env.VITE_RELEASE': JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? '') },
  server: { port: 5180, strictPort: true },
})
