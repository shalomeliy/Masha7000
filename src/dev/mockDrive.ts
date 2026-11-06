// Local testing only (never in the build): an in-memory Google Drive with sample data, and a fake
// sign-in. Turn on in the browser console: localStorage.setItem('dev.mockDrive', '1'), then reload.
// Turn off: localStorage.removeItem('dev.mockDrive'). Files written here are kept in sessionStorage.

const files = new Map<string, { id: string; name: string; body: string; version: number }>(
  JSON.parse(sessionStorage.getItem('dev.mockDrive.files') ?? '[]'),
)
const persist = () => sessionStorage.setItem('dev.mockDrive.files', JSON.stringify([...files]))

const seed: Record<string, unknown> = {
  'roles_definition.json': [
    { id: 'general', name: 'כללי' },
    { id: 'r1', name: 'טפסן' },
    { id: 'r2', name: 'חשמלאי' },
    { id: 'r3', name: 'טכנאי אנטנות' },
    { id: 'r4', name: 'טכנאי מצלמות' },
  ],
  'certifications.json': [{ id: 'c1', name: 'אנטנה בגובה 40 מטר' }],
  'workers.json': [
    { id: 'w1', firstName: 'דני', lastName: 'לוי', mobilePhone: '0501111111', roleIds: ['r1'], certificationIds: ['c1'], constraints: [] },
    { id: 'w2', firstName: 'יוסי', lastName: 'כהן', mobilePhone: '0502222222', roleIds: ['r1'], certificationIds: [], constraints: [] },
    { id: 'w3', firstName: 'רון', lastName: 'מזרחי', mobilePhone: '0503333333', roleIds: ['r4'], certificationIds: [], constraints: [] },
    { id: 'w4', firstName: 'אבי', lastName: 'פרץ', mobilePhone: '0504444444', roleIds: ['r2', 'r1'], certificationIds: [], constraints: [] },
  ],
  'shift_definitions.json': [
    { id: 's1', name: 'יום', requiredRoleIds: [], requiredCertificationIds: [], startTime: '07:00', endTime: '16:00' },
    { id: 's2', name: 'לילה', requiredRoleIds: [], requiredCertificationIds: [], startTime: '07:00', endTime: '16:00', endsNextDay: true },
  ],
  'places.json': [{ id: 'p1', name: 'אילת אתר 123' }],
}
if (files.size === 0) {
  for (const [name, body] of Object.entries(seed)) files.set(name, { id: `id-${name}`, name, body: JSON.stringify(body), version: 1 })
  persist()
}

localStorage.setItem('shiftsmart.token', JSON.stringify({ value: 'mock', expiresAt: Date.now() + 864e5 }))
localStorage.removeItem('shiftsmart.mode')

const realFetch = window.fetch.bind(window)
const reply = (body: unknown, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
const meta = (f: { id: string; version: number }) => ({ id: f.id, version: String(f.version), name: (f as { name?: string }).name })

window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.startsWith('/api/token')) return reply({ reason: 'not-configured' }, 503)
  if (!url.startsWith('https://www.googleapis.com/')) return realFetch(input, init)
  const u = new URL(url)
  const method = (init.method ?? 'GET').toUpperCase()
  const q = u.searchParams.get('q') ?? ''
  if (u.pathname === '/drive/v3/files' && method === 'GET') {
    const exact = /name = '([^']+)'/.exec(q)?.[1]
    const part = /name contains '([^']+)'/.exec(q)?.[1]
    const found = [...files.values()].filter((f) => (exact ? f.name === exact : part ? f.name.includes(part) : true))
    return reply({ files: found.map(meta) })
  }
  const id = /\/files\/([^/?]+)/.exec(u.pathname)?.[1]
  const byId = [...files.values()].find((f) => f.id === id)
  if (u.pathname.startsWith('/drive/v3/files/') && method === 'GET' && byId) return reply(byId.body)
  if (u.pathname.startsWith('/upload/drive/v3/files/') && method === 'PATCH' && byId) {
    byId.body = String(init.body)
    byId.version++
    persist()
    return reply(meta(byId))
  }
  if (u.pathname === '/upload/drive/v3/files' && method === 'POST') {
    const form = init.body as FormData
    const { name } = JSON.parse(await (form.get('metadata') as Blob).text()) as { name: string }
    const f = { id: `id-${name}`, name, body: await (form.get('file') as Blob).text(), version: 1 }
    files.set(name, f)
    persist()
    return reply(meta(f))
  }
  if (u.pathname.startsWith('/drive/v3/files/') && method === 'PATCH' && byId) return reply(meta(byId))
  return reply({ error: 'mock: not handled' }, 404)
}
