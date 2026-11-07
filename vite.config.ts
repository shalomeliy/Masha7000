import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

// Local only: /api/assistant answers with a fixed stand-in (api/_lib/assistantMock.ts), with no sign-in
// checks (there is no sign-in server locally). It never reads an Anthropic key and never calls
// Anthropic: the app's key pays real money, so local work must not be able to spend it (CLAUDE.md).
// Never part of the build.
function localAssistant(): Plugin {
  return {
    name: 'local-assistant',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/assistant', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          return res.end(JSON.stringify({ reason: 'bad-method' }))
        }
        let raw = ''
        for await (const chunk of req) raw += chunk
        const { mockAssistantStream } = (await server.ssrLoadModule('/api/_lib/assistantMock.ts')) as typeof import('./api/_lib/assistantMock.ts')
        const body = JSON.parse(raw || '{}') as { messages?: unknown }
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
        const reader = mockAssistantStream(body.messages).getReader()
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
