import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// Local only: /api/assistant with no sign-in checks (there is no sign-in server locally). By default it
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
      server.middlewares.use('/api/assistant', async (req, res) => {
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
  server: { port: 5180, strictPort: true },
})
