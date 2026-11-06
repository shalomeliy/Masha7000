import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// Local only: /api/assistant answers from this machine with ANTHROPIC_API_KEY from .env.local,
// without the sign-in checks (there is no sign-in server locally). Never part of the build.
function localAssistant(): Plugin {
  return {
    name: 'local-assistant',
    apply: 'serve',
    configureServer(server) {
      const env = loadEnv('development', process.cwd(), '')
      const key = env.ANTHROPIC_API_KEY ?? ''
      server.middlewares.use('/api/assistant', async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }
        if (req.method !== 'POST') return send(405, { reason: 'bad-method' })
        if (!key) return send(503, { reason: 'no-key' })
        let raw = ''
        for await (const chunk of req) raw += chunk
        const { runAssistant } = (await server.ssrLoadModule('/api/_lib/assistant.ts')) as typeof import('./api/_lib/assistant.ts')
        const body = JSON.parse(raw || '{}') as { messages?: unknown; context?: unknown; smart?: unknown }
        const reply = await runAssistant(key, body.messages, body.context, env.ASSISTANT_MODEL, body.smart === true)
        send(reply.ok ? 200 : 502, reply.ok ? reply : { reason: reply.reason })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), localAssistant()],
  server: { port: 5180, strictPort: true },
})
