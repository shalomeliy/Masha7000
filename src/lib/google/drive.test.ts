import { beforeEach, describe, expect, it, vi } from 'vitest'

// A fake Drive: one file whose version rises on every write; "someone else" can bump it.
let file: { version: number; body: string } | null
let writes: number
let downloads: number
let md5: boolean // whether the fake Drive reports content checksums
let searches: number // listings and searches of the folder
const sum = (body: string) => `md5:${body}`

vi.mock('./auth', () => ({
  googleFetch: async (url: string, init?: RequestInit) => {
    const json = (b: unknown) => new Response(JSON.stringify(b))
    const meta = () => ({ version: String(file!.version), ...(md5 ? { md5Checksum: sum(file!.body) } : {}) })
    if (url.includes('?spaces=appDataFolder')) {
      searches++
      return json({ files: file ? [{ id: 'f1', name: 'a.json', ...meta() }] : [] })
    }
    if (url.includes('alt=media')) {
      downloads++
      return new Response(file!.body)
    }
    writes++
    if (init?.method === 'PATCH') file = { version: file!.version + 1, body: String(init.body) }
    else file = { version: 1, body: '[]' }
    return json(meta())
  },
}))

const load = () => import('./drive')

beforeEach(() => {
  vi.resetModules()
  file = { version: 5, body: '[1]' }
  writes = 0
  downloads = 0
  searches = 0
  md5 = false
})

describe('reading many lists at once', () => {
  it('lists the folder once for reads that start together, not one search per file', async () => {
    const drive = await load()
    const read = await Promise.all([drive.readJson('a.json'), drive.readJson('b.json'), drive.peekJson('a.json'), drive.listNames('a', /json/)])
    expect(read).toEqual([[1], null, [1], ['a.json']])
    expect(searches).toBe(1)
  })

  it('lists again after this screen saved, so the next read sees the new version', async () => {
    const drive = await load()
    await drive.readJson('a.json')
    await drive.writeJson('a.json', [1, 2])
    expect(await drive.readJson('a.json')).toEqual([1, 2])
    await drive.writeJson('a.json', [1, 2, 3]) // no false conflict from an old listing
    expect(file).toEqual({ version: 7, body: '[1,2,3]' })
  })

  it('does not use a listing older than a few seconds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const drive = await load()
      await drive.readJson('a.json')
      file = { version: 6, body: '[9]' } // the other manager's save
      vi.setSystemTime(Date.now() + 10_000)
      expect(await drive.readJson('a.json')).toEqual([9])
      await drive.writeJson('a.json', [9, 1])
      expect(file.body).toBe('[9,1]')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('writeJson version check', () => {
  it('saves when nobody changed the file since it was read, and keeps saving', async () => {
    const drive = await load()
    expect(await drive.readJson('a.json')).toEqual([1])
    await drive.writeJson('a.json', [1, 2])
    await drive.writeJson('a.json', [1, 2, 3])
    expect(file).toEqual({ version: 7, body: '[1,2,3]' })
  })

  it('refuses to overwrite a change someone else saved in between', async () => {
    const drive = await load()
    await drive.readJson('a.json')
    file = { version: 6, body: '[9]' } // the other manager's save
    await expect(drive.writeJson('a.json', [1, 2])).rejects.toBeInstanceOf(drive.ConflictError)
    expect(file.body).toBe('[9]')
    expect(writes).toBe(0)
  })

  it('saves when Drive only raised the version on its own, without changing the content', async () => {
    const drive = await load()
    await drive.readJson('a.json')
    await drive.writeJson('a.json', [1, 2])
    file = { version: file!.version + 1, body: file!.body } // Drive's own late bump after the upload
    await drive.writeJson('a.json', [1, 2, 3])
    expect(file.body).toBe('[1,2,3]')
  })

  it("tells a bare version bump from Drive's checksum, without downloading the file", async () => {
    const drive = await load()
    await drive.readJson('a.json')
    downloads = 0
    md5 = true
    await drive.writeJson('a.json', [1, 2])
    file = { version: file!.version + 1, body: file!.body }
    await drive.writeJson('a.json', [1, 2, 3])
    expect(file.body).toBe('[1,2,3]')
    expect(downloads).toBe(0)
  })

  it('refuses a change someone else saved when the checksums differ', async () => {
    md5 = true
    const drive = await load()
    await drive.readJson('a.json')
    file = { version: 6, body: '[9]' }
    await expect(drive.writeJson('a.json', [1, 2])).rejects.toBeInstanceOf(drive.ConflictError)
  })

  it('refuses when someone created the file after this screen saw none', async () => {
    file = null
    const drive = await load()
    expect(await drive.readJson('a.json')).toBeNull()
    file = { version: 1, body: '[9]' }
    await expect(drive.writeJson('a.json', [1])).rejects.toBeInstanceOf(drive.ConflictError)
  })
})
