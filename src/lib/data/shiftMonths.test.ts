import { beforeEach, describe, expect, it, vi } from 'vitest'

// A fake Drive folder: file name -> content. Versions are not checked here (drive.test does that).
let files: Map<string, string>
let uploads: string[]
let failUpload: string | null // a month file whose upload fails, as on a lost connection

vi.mock('../google/auth', () => ({
  googleFetch: async (url: string, init?: RequestInit) => {
    const json = (b: unknown) => new Response(JSON.stringify(b))
    const u = new URL(url)
    const id = u.pathname.split('/').pop()!
    if (init?.method && u.pathname.includes('/upload/') && id === failUpload) throw new Error('offline')
    if (init?.method === 'PATCH' && u.pathname.includes('/upload/')) {
      uploads.push(id)
      files.set(id, String(init.body))
      return json({})
    }
    if (init?.method === 'PATCH') {
      const { name } = JSON.parse(String(init.body)) as { name: string }
      files.set(name, files.get(id)!)
      files.delete(id)
      return json({})
    }
    if (init?.method === 'POST') {
      const form = init.body as FormData
      const { name } = JSON.parse(await (form.get('metadata') as Blob).text()) as { name: string }
      if (name === failUpload) throw new Error('offline')
      uploads.push(name)
      files.set(name, await (form.get('file') as Blob).text())
      return json({})
    }
    if (url.includes('alt=media')) return new Response(files.get(id))
    const q = u.searchParams.get('q')!
    const exact = q.match(/name = '(.+?)'/)
    if (exact) return json({ files: files.has(exact[1]) ? [{ id: exact[1], version: '1' }] : [] })
    const part = q.match(/name contains '(.+?)'/)![1]
    return json({ files: [...files.keys()].filter((n) => n.includes(part)).map((name) => ({ name })) })
  },
}))

const load = () => import('./shiftMonths')
const shift = (id: string, date: string) => ({ id, date })

beforeEach(() => {
  vi.resetModules()
  files = new Map()
  uploads = []
  failUpload = null
})

describe('shifts kept by month', () => {
  it('splits an old shifts.json into months and keeps the old file under another name', async () => {
    files.set('shifts.json', JSON.stringify([shift('a', '2026-10-30'), shift('b', '2026-11-01'), shift('c', '2026-11-02')]))
    const m = await load()
    expect((await m.readShifts())!.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(JSON.parse(files.get('shifts-2026-10.json')!)).toEqual([shift('a', '2026-10-30')])
    expect(JSON.parse(files.get('shifts-2026-11.json')!).map((s: { id: string }) => s.id)).toEqual(['b', 'c'])
    expect(files.has('shifts.json')).toBe(false)
    expect([...files.keys()].some((n) => n.startsWith('shifts-old-'))).toBe(true)
  })

  it('a save writes only the month that changed', async () => {
    files.set('shifts-2026-10.json', JSON.stringify([shift('a', '2026-10-30')]))
    files.set('shifts-2026-11.json', JSON.stringify([shift('b', '2026-11-01')]))
    const m = await load()
    const all = (await m.readShifts())!
    await m.saveShifts([...all, shift('c', '2026-11-05')])
    expect(uploads).toEqual(['shifts-2026-11.json'])
  })

  it('moving a shift to another month empties it from the old one', async () => {
    files.set('shifts-2026-10.json', JSON.stringify([shift('a', '2026-10-30')]))
    const m = await load()
    await m.readShifts()
    await m.saveShifts([shift('a', '2026-11-02')])
    expect(JSON.parse(files.get('shifts-2026-10.json')!)).toEqual([])
    expect(JSON.parse(files.get('shifts-2026-11.json')!)).toEqual([shift('a', '2026-11-02')])
  })

  it('nothing saved yet reads as null; a shifts.json written again by an older app wins by id', async () => {
    const m = await load()
    expect(await m.readShifts()).toBeNull()
    files.set('shifts-2026-11.json', JSON.stringify([shift('a', '2026-11-01'), shift('b', '2026-11-02')]))
    files.set('shifts.json', JSON.stringify([{ ...shift('a', '2026-11-03') }]))
    const ids = (await m.readShifts())!.map((s) => `${s.id}:${s.date}`)
    expect(ids.sort()).toEqual(['a:2026-11-03', 'b:2026-11-02'])
  })

  it('a restore replaces months this screen never read', async () => {
    files.set('shifts-2025-01.json', JSON.stringify([shift('old', '2025-01-01')]))
    const m = await load()
    await m.restoreShifts([shift('x', '2026-11-01')], false)
    expect(JSON.parse(files.get('shifts-2025-01.json')!)).toEqual([])
    expect(JSON.parse(files.get('shifts-2026-11.json')!)).toEqual([shift('x', '2026-11-01')])
  })

  it('a month someone else created after this screen read is a conflict, not overwritten', async () => {
    const m = await load()
    const { ConflictError } = await import('../google/drive')
    await m.readShifts()
    files.set('shifts-2026-12.json', JSON.stringify([shift('theirs', '2026-12-01')]))
    await expect(m.saveShifts([shift('mine', '2026-12-02')])).rejects.toBeInstanceOf(ConflictError)
    expect(JSON.parse(files.get('shifts-2026-12.json')!)).toEqual([shift('theirs', '2026-12-01')])
  })

  it('a move cut in the middle never loses the shift', async () => {
    files.set('shifts-2026-12.json', JSON.stringify([shift('a', '2026-12-30')]))
    const m = await load()
    await m.readShifts()
    failUpload = 'shifts-2026-12.json' // the month the shift leaves
    await expect(m.saveShifts([shift('a', '2027-01-02')])).rejects.toThrow()
    const again = await (await load()).readShifts()
    expect(again!.map((s) => s.id)).toEqual(['a'])
  })

  it('a restore puts aside a shifts.json left by an older app', async () => {
    files.set('shifts.json', JSON.stringify([shift('stale', '2026-11-01')]))
    const m = await load()
    await m.restoreShifts([shift('x', '2026-11-01')], false)
    expect(files.has('shifts.json')).toBe(false)
    expect((await (await load()).readShifts())!.map((s) => s.id)).toEqual(['x'])
  })
})

describe('opening reads only the recent months', () => {
  it('the window starts three months before this month', async () => {
    const m = await load()
    expect(m.windowStart('2026-11-09')).toBe('2026-08')
    expect(m.windowStart('2026-02-28')).toBe('2025-11')
    expect(m.windowStart('2026-03-01')).toBe('2025-12')
  })

  it('reads only months from the window on; a save never touches the older ones', async () => {
    files.set('shifts-2026-01.json', JSON.stringify([shift('old', '2026-01-05')]))
    files.set('shifts-2026-10.json', JSON.stringify([shift('a', '2026-10-30')]))
    const m = await load()
    const recent = (await m.readShifts('2026-08'))!
    expect(recent.map((s) => s.id)).toEqual(['a'])
    await m.saveShifts([...recent, shift('b', '2026-11-01')])
    expect(uploads).toEqual(['shifts-2026-11.json'])
    expect(JSON.parse(files.get('shifts-2026-01.json')!)).toEqual([shift('old', '2026-01-05')])
  })

  it('only old months on Drive still counts as saved, not as a new list', async () => {
    files.set('shifts-2025-01.json', JSON.stringify([shift('old', '2025-01-05')]))
    const m = await load()
    expect(await m.readShifts('2026-08')).toEqual([])
  })

  it("a shift dated into an unread month keeps that month's shifts and joins them to the list", async () => {
    files.set('shifts-2026-01.json', JSON.stringify([shift('old', '2026-01-05')]))
    const m = await load()
    await m.readShifts('2026-08')
    const saved = await m.saveShifts([shift('moved', '2026-01-20')])
    expect(saved.map((s) => s.id).sort()).toEqual(['moved', 'old'])
    expect(JSON.parse(files.get('shifts-2026-01.json')!).map((s: { id: string }) => s.id).sort()).toEqual(['moved', 'old'])
  })

  it('the whole history reads every month', async () => {
    files.set('shifts-2026-01.json', JSON.stringify([shift('old', '2026-01-05')]))
    files.set('shifts-2026-10.json', JSON.stringify([shift('a', '2026-10-30')]))
    const m = await load()
    await m.readShifts('2026-08')
    expect((await m.readShifts())!.map((s) => s.id)).toEqual(['old', 'a'])
  })
})
