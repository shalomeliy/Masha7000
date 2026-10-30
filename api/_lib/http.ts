// Cookies and responses. Every /api answer is no-store and has no CORS headers,
// so only the app's own pages can read it.

export const SESSION_COOKIE = '__Host-session'
export const STATE_COOKIE = '__Host-oauth'
export const SESSION_DAYS = 180

export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

export const setCookie = (name: string, value: string, maxAgeSeconds: number) =>
  `${name}=${value}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`

export const clearCookie = (name: string) => setCookie(name, '', 0)

export function json(body: unknown, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  for (const c of cookies) headers.append('Set-Cookie', c)
  return new Response(JSON.stringify(body), { status, headers })
}

export function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' })
  for (const c of cookies) headers.append('Set-Cookie', c)
  return new Response(null, { status: 302, headers })
}

/** Any crash becomes an answer the app understands (a failure, never "no server"). Never logs tokens. */
export function guarded(handler: (req: Request) => Response | Promise<Response>) {
  return async (req: Request) => {
    try {
      return await handler(req)
    } catch (e) {
      const path = new URL(req.url).pathname
      console.error('api error', path, (e as Error).name)
      return path.startsWith('/api/auth/') ? redirect('/?signin=failed') : json({ reason: 'server-error' }, 500)
    }
  }
}

/** POSTs from the app's own pages only (a browser always sends Origin on a POST). */
export const sameOrigin = (req: Request, appOrigin: string) => req.headers.get('origin') === appOrigin
