import { json } from './http.js'

// Vercel's Hobby plan builds at most 12 function files (api/_lib/functionCount.test.ts). So several routes
// share one function file: vercel.json rewrites /api/token to /api/signin?fn=token, and this picks the handler.
// The public URLs never changed. If the rewrite's ?fn is missing, the path
// itself names the route (/api/auth/start -> 'auth-start').

type Handler = (req: Request) => Response | Promise<Response>
type Route = Partial<Record<'GET' | 'POST' | 'DELETE', Handler>>

export function routeName(req: Request): string {
  const url = new URL(req.url)
  return url.searchParams.get('fn') ?? url.pathname.replace(/^\/api\//, '').replace(/\/+$/, '').replaceAll('/', '-')
}

export function router(routes: Record<string, Route>) {
  const pick = (method: keyof Route) => (req: Request) => {
    const name = routeName(req)
    const route = Object.hasOwn(routes, name) ? routes[name] : undefined
    if (!route) return json({ reason: 'not-found' }, 404)
    const handler = route[method]
    return handler ? handler(req) : json({ reason: 'method-not-allowed' }, 405)
  }
  return { GET: pick('GET'), POST: pick('POST'), DELETE: pick('DELETE') }
}
