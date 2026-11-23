import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs server without types
import { allTools, makeApi, makeHandler } from './server.mjs'
// @ts-expect-error plain .mjs server without types
import { changeCode, crewProblems, findByName, hebrewWarning, makeWriteTools } from './write.mjs'

type Obj = Record<string, unknown>
const W = (id: string, first: string, last: string, extra: Obj = {}) => ({ id, firstName: first, lastName: last, status: 'active', sickUntil: null, departmentId: null, certifications: [], constraints: [], ...extra })
const S = (o: Obj) => ({ id: 's1', date: '2026-11-24', shiftKindId: 'k-night', location: 'חולון', jobDescription: 'אנטנה', crew: ['w1'], pinnedWorkerIds: [], staffing: [{ certificationIds: [], workKindId: null }], workKindIds: [], urgent: false, startTime: null, endDate: null, endTime: null, fromPendingJobId: null, nextJob: null, closure: null, ...o })
const LISTS = { certs: [{ id: 'c-climb', name: 'טיפוס' }], kinds: [{ id: 'k-day', name: 'יום' }, { id: 'k-night', name: 'לילה' }], departments: [], workKinds: [] }
const WORKERS = [
  W('w1', 'שלום', 'לוי'),
  W('w2', 'יותם', 'כהן'),
  W('w3', 'אלי', 'כהן'),
  W('w4', 'אלי', 'מזרחי'),
  W('w5', 'אבי', 'דהן', { status: 'sick', sickUntil: '2026-11-30' }),
  W('w6', 'משה', 'פרץ', { constraints: [{ id: 'k', kind: 'vacation', when: 'dates', from: '2026-11-24', to: '2026-11-26', weekdays: [], nightsOnly: false, part: null }] }),
]

/** A fake api: reads from memory, records every write. */
function fakeApi() {
  const writes: { method: string; path: string; body: Obj }[] = []
  return {
    writes,
    get: async (path: string) => {
      if (path.startsWith('workers')) return WORKERS
      if (path.startsWith('shifts/')) return S({})
      if (path.startsWith('shifts')) return [S({})]
      return []
    },
    named: async () => LISTS,
    send: async (method: string, path: string, body: Obj) => {
      writes.push({ method, path, body })
      if (path === 'shifts') return { data: S({ id: 'new', ...body, shiftKindId: body.shiftKindId ?? null, location: body.location ?? '', jobDescription: body.jobDescription ?? '' }), warnings: ['worker w1 is also in shift s1 on 2026-11-24'] }
      if (path.startsWith('shifts/')) return { data: S(body), warnings: [] }
      if (path === 'pending-jobs') return { data: { id: 'p', location: body.location ?? '', jobDescription: body.jobDescription ?? '', shiftKindId: null, staffing: [], createdAt: 'x' }, warnings: [] }
      if (path.endsWith('/constraints')) return { data: { id: 'c', kind: body.kind ?? null, when: body.when, from: body.from ?? null, to: body.to ?? body.from ?? null, weekdays: body.weekdays ?? [], nightsOnly: false, part: body.part ?? null }, warnings: [] }
      return { data: { ...WORKERS[1], ...body }, warnings: [] }
    },
  }
}
const run = async (api: ReturnType<typeof fakeApi>, name: string, args: Obj) => {
  const handle = makeHandler(makeWriteTools(api))
  const r = await handle({ id: 1, method: 'tools/call', params: { name, arguments: args } })
  return { error: r.isError === true, text: r.content[0].text as string, out: r.isError ? null : JSON.parse(r.content[0].text) }
}
/** Ask for the read-back, then approve exactly it. */
const approve = async (api: ReturnType<typeof fakeApi>, name: string, args: Obj) => {
  const first = await run(api, name, args)
  expect(first.out.written).toBe(false)
  return run(api, name, { ...args, confirm: true, changeCode: first.out.changeCode })
}

describe('names', () => {
  const name = (w: Obj) => `${w.firstName} ${w.lastName}`
  it('finds by full name, by first name when only one fits, and refuses when two fit or none', () => {
    expect(findByName(WORKERS, 'יותם כהן', name, 'עובד').id).toBe('w2')
    expect(findByName(WORKERS, 'יותם', name, 'עובד').id).toBe('w2')
    expect(() => findByName(WORKERS, 'אלי', name, 'עובד')).toThrow(/אלי כהן, אלי מזרחי/)
    expect(findByName(WORKERS, 'אלי מזרחי', name, 'עובד').id).toBe('w4')
    expect(() => findByName(WORKERS, 'דוד', name, 'עובד')).toThrow(/לא מצאתי/)
  })
  it('turns API warnings into Hebrew with names', () => {
    expect(hebrewWarning('worker w2 is also in shift s9 on 2026-11-24', WORKERS)).toBe('יותם כהן כבר משובץ בעבודה אחרת ב-2026-11-24')
    expect(hebrewWarning('worker w5 is marked sick', WORKERS)).toBe('אבי דהן מסומן חולה')
  })
  it('warns before writing about a sick, busy or constrained crew member', () => {
    const p = crewProblems(['w1', 'w5', 'w6', 'w2'], '2026-11-24', WORKERS, [S({})], undefined)
    expect(p).toEqual(['שלום לוי כבר משובץ באותו יום: חולון', 'אבי דהן מסומן חולה עד 2026-11-30', 'למשה פרץ יש אילוץ באותו יום: חופש'])
  })
})

describe('read-back before every write', () => {
  it('a write tool without confirm returns a Hebrew read-back and writes nothing', async () => {
    const api = fakeApi()
    const r = await run(api, 'add_shift', { date: '2026-11-25', location: 'רמלה', job: 'תיקון', kind: 'יום', crew: ['יותם', 'אבי'] })
    expect(api.writes).toEqual([])
    expect(r.out).toMatchObject({ preview: true, written: false, change: { date: '2026-11-25', location: 'רמלה', jobDescription: 'תיקון', shiftKindId: 'k-day', crew: ['w2', 'w5'] } })
    expect(r.out.readBack).toBe('להוסיף עבודה ביום רביעי 25.11 (יום): רמלה - תיקון. צוות: יותם כהן, אבי דהן.')
    expect(r.out.warnings).toEqual(['אבי דהן מסומן חולה עד 2026-11-30'])
    expect(r.out.changeCode).toMatch(/^[0-9a-f]{10}$/)
  })

  it('confirm without the approved code, or with a changed request, writes nothing', async () => {
    const api = fakeApi()
    const args = { date: '2026-11-25', location: 'רמלה', crew: ['יותם'] }
    const first = await run(api, 'add_shift', args)
    expect((await run(api, 'add_shift', { ...args, confirm: true })).text).toMatch(/לא כתבתי כלום/)
    const changed = await run(api, 'add_shift', { ...args, crew: ['יותם', 'שלום'], confirm: true, changeCode: first.out.changeCode })
    expect(changed.text).toMatch(/לא כתבתי כלום/)
    expect(api.writes).toEqual([])
  })

  it('after approval it writes exactly the read-back, and gives the API warnings in Hebrew', async () => {
    const api = fakeApi()
    const r = await approve(api, 'add_shift', { date: '2026-11-24', location: 'רמלה', kind: 'לילה', crew: ['שלום'] })
    expect(api.writes).toEqual([{ method: 'POST', path: 'shifts', body: { date: '2026-11-24', location: 'רמלה', shiftKindId: 'k-night', crew: ['w1'] } }])
    expect(r.out.written).toBe(true)
    expect(r.out.result).toMatchObject({ kind: 'לילה', crew: ['שלום לוי'] })
    expect(r.out.warnings).toEqual(['שלום לוי כבר משובץ בעבודה אחרת ב-2026-11-24'])
  })

  it('the code is tied to the tool and the exact change', () => {
    expect(changeCode('add_shift', { a: 1 })).toBe(changeCode('add_shift', { a: 1 }))
    expect(changeCode('add_shift', { a: 1 })).not.toBe(changeCode('add_shift', { a: 2 }))
    expect(changeCode('add_shift', { a: 1 })).not.toBe(changeCode('add_pending_job', { a: 1 }))
  })
})

describe('each write tool', () => {
  it('update_shift adds and removes crew by name and reads the change back', async () => {
    const api = fakeApi()
    const first = await run(api, 'update_shift', { shiftId: 's1', addWorkers: ['יותם'], removeWorkers: ['שלום'] })
    expect(first.out.change).toEqual({ crew: ['w2'] })
    expect(first.out.readBack).toContain('נכנס לצוות: יותם כהן')
    expect(first.out.readBack).toContain('יוצא מהצוות: שלום לוי')
    await approve(api, 'update_shift', { shiftId: 's1', addWorkers: ['יותם'], removeWorkers: ['שלום'] })
    expect(api.writes).toEqual([{ method: 'PATCH', path: 'shifts/s1', body: { crew: ['w2'] } }])
  })

  it('update_shift moves a date and refuses a change that changes nothing', async () => {
    const api = fakeApi()
    const r = await run(api, 'update_shift', { shiftId: 's1', date: '2026-11-26' })
    expect(r.out.readBack).toContain('תאריך: יום שלישי 24.11 ← יום חמישי 26.11')
    expect((await run(api, 'update_shift', { shiftId: 's1', date: '2026-11-24' })).text).toMatch(/אין מה לשנות/)
  })

  it('add_pending_job, set_worker_status and add_constraint send what the API expects', async () => {
    const api = fakeApi()
    await approve(api, 'add_pending_job', { location: 'ערד', job: 'בדיקה', kind: 'יום' })
    await approve(api, 'set_worker_status', { worker: 'יותם', status: 'חולה', sickUntil: '2026-11-27' })
    await approve(api, 'add_constraint', { worker: 'יותם', kind: 'מילואים', from: '2026-12-01', to: '2026-12-10' })
    await approve(api, 'add_constraint', { worker: 'שלום', weekdays: ['שלישי'], part: 'ערב' })
    expect(api.writes).toEqual([
      { method: 'POST', path: 'pending-jobs', body: { location: 'ערד', jobDescription: 'בדיקה', shiftKindId: 'k-day' } },
      { method: 'PATCH', path: 'workers/w2', body: { status: 'sick', sickUntil: '2026-11-27' } },
      { method: 'POST', path: 'workers/w2/constraints', body: { when: 'dates', from: '2026-12-01', to: '2026-12-10', kind: 'reserve' } },
      { method: 'POST', path: 'workers/w1/constraints', body: { when: 'weekdays', weekdays: [2], part: 'evening' } },
    ])
  })

  it('refuses unclear input before any write', async () => {
    const api = fakeApi()
    expect((await run(api, 'set_worker_status', { worker: 'יותם', status: 'חולה' })).error).toBe(true) // no sickUntil
    expect((await run(api, 'set_worker_status', { worker: 'אלי', status: 'פעיל' })).text).toMatch(/יותר מעובד אחד/)
    expect((await run(api, 'add_constraint', { worker: 'יותם', weekdays: ['יום ט'] })).text).toMatch(/יום לא מוכר/)
    expect((await run(api, 'add_shift', { date: 'מחר', location: 'x' })).error).toBe(true)
    expect(api.writes).toEqual([])
  })
})

describe('through the real API client', () => {
  it('without confirm only GET requests leave; a read-only key gets a clear Hebrew refusal', async () => {
    const seen: string[] = []
    let refuse = false
    const fetchFn = async (url: string, init: { method?: string }) => {
      seen.push(init.method ?? 'GET')
      if (refuse && init.method !== 'GET') return new Response(JSON.stringify({ error: { code: 'no-scope', message: 'this key may only read' } }), { status: 403 })
      const what = new URL(url).pathname.split('/').pop()
      const data: Obj = { workers: WORKERS, certifications: LISTS.certs, 'shift-kinds': LISTS.kinds }
      return new Response(JSON.stringify({ data: data[what!] ?? [] }))
    }
    const handle = makeHandler(allTools(makeApi('k', 'http://x/api/v1', fetchFn)))
    const call = async (args: Obj) => (await handle({ id: 1, method: 'tools/call', params: { name: 'add_pending_job', arguments: args } })).content[0].text
    const first = JSON.parse(await call({ location: 'ערד' }))
    expect(seen.every((m) => m === 'GET')).toBe(true)
    refuse = true
    expect(await call({ location: 'ערד', confirm: true, changeCode: first.changeCode })).toMatch(/מותר רק לקריאה/)
    expect(seen.filter((m) => m !== 'GET')).toEqual(['POST'])
  })

  it('lists the five write tools after the read tools, each with the approval rule', async () => {
    const r = await makeHandler(allTools({ get: async () => [], named: async () => LISTS, send: async () => ({}) }))({ id: 1, method: 'tools/list' })
    const names = r.tools.map((t: { name: string }) => t.name)
    expect(names.slice(5)).toEqual(['add_shift', 'update_shift', 'add_pending_job', 'set_worker_status', 'add_constraint'])
    for (const t of r.tools.slice(5)) expect(t.description).toContain('Never set confirm: true until the manager explicitly approved the latest read-back')
  })
})
