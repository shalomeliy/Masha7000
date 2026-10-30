import { beforeEach, describe, expect, it, vi } from 'vitest'

// A fake Drive: one file whose version rises on every write; "someone else" can bump it.
let file: { version: number; body: string } | null
let writes: number

vi.mock('./auth', () => ({
  googleFetch: async (url: string, init?: RequestInit) => {
    const json = (b: unknown) => new Response(JSON.stringify(b))
    if (url.includes('?spaces=appDataFolder')) return json({ files: file ? [{ id: 'f1', version: String(file.version) }] : [] })
    if (url.includes('alt=media')) return new Response(file!.body)
    writes++
    if (init?.method === 'PATCH') file = { version: file!.version + 1, body: String(init.body) }
    else file = { version: 1, body: '[]' }
    return json({ version: String(file.version) })
  },
}))

const load = () => import('./drive')

beforeEach(() => {
  vi.resetModules()
  file = { version: 5, body: '[1]' }
  writes = 0
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

  it('refuses when someone created the file after this screen saw none', async () => {
    file = null
    const drive = await load()
    expect(await drive.readJson('a.json')).toBeNull()
    file = { version: 1, body: '[9]' }
    await expect(drive.writeJson('a.json', [1])).rejects.toBeInstanceOf(drive.ConflictError)
  })
})
