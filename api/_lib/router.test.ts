import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as forms from '../forms.js'
import * as manage from '../manage.js'
import * as signin from '../signin.js'
import { router, routeName } from './router.js'

const entries: Record<string, { routes: Record<string, object> }> = { signin, manage, forms }
const vercel = JSON.parse(readFileSync(join(__dirname, '..', '..', 'vercel.json'), 'utf8')) as {
  rewrites: { source: string; destination: string }[]
}

describe('router', () => {
  it('reads the route from the rewrite, else from the path', () => {
    expect(routeName(new Request('https://x/api/signin?fn=token&stale=1'))).toBe('token')
    expect(routeName(new Request('https://x/api/auth/callback?state=s'))).toBe('auth-callback')
    expect(routeName(new Request('https://x/api/claude-log/'))).toBe('claude-log')
  })

  it('runs the matching handler, 404 for an unknown route, 405 for a wrong method', async () => {
    const r = router({ a: { GET: () => new Response('a') } })
    expect(await (await r.GET(new Request('https://x/api/e?fn=a'))).text()).toBe('a')
    expect((await r.GET(new Request('https://x/api/e?fn=b'))).status).toBe(404)
    expect((await r.GET(new Request('https://x/api/e?fn=toString'))).status).toBe(404)
    expect((await r.POST(new Request('https://x/api/e?fn=a', { method: 'POST' }))).status).toBe(405)
  })
})

describe('vercel.json rewrites', () => {
  const shared = vercel.rewrites.filter((r) => r.destination.includes('?fn='))

  it('every shared URL lands on a route that exists', () => {
    for (const r of shared) {
      const [path, fn] = r.destination.split('?fn=')
      const entry = entries[path.replace('/api/', '')]
      expect(entry, r.destination).toBeDefined()
      expect(Object.keys(entry.routes), r.source).toContain(fn)
      // The path fallback names the same route, so a rewrite that drops ?fn still works.
      expect(routeName(new Request(`https://x${r.source}`))).toBe(fn)
    }
  })

  it('every route has a public URL', () => {
    for (const [name, entry] of Object.entries(entries))
      for (const fn of Object.keys(entry.routes))
        expect(shared.some((r) => r.destination === `/api/${name}?fn=${fn}`), `${name}:${fn}`).toBe(true)
  })

  it('the app pages never fall through to index.html for an /api URL', () => {
    const spa = vercel.rewrites.find((r) => r.destination === '/index.html')
    expect(spa?.source).toContain('(?!api/')
  })
})
