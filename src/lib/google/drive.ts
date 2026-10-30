import { googleFetch } from './auth'

// JSON files in the owner's Drive appDataFolder: hidden from the user, visible only to this app.
// Several people can edit the same files, so each write checks that the file's Drive version is
// still the one this screen read; if someone else saved in between, the write is refused
// (ConflictError) instead of silently erasing their change. A small window between the check
// and the write remains; with two or three managers that is accepted.

const FILES_API = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files'

export class ConflictError extends Error {}

/** Drive version of each file as last read or written here; 'none' = the file did not exist. */
const versions = new Map<string, string>()

async function findFile(name: string): Promise<{ id: string; version: string } | null> {
  const q = encodeURIComponent(`name = '${name}' and trashed = false`)
  const res = await googleFetch(`${FILES_API}?spaces=appDataFolder&q=${q}&fields=files(id,version)`)
  const data: { files: { id: string; version: string }[] } = await res.json()
  return data.files[0] ?? null
}

export async function readJson<T>(name: string): Promise<T | null> {
  const file = await findFile(name)
  versions.set(name, file?.version ?? 'none')
  if (!file) return null
  const res = await googleFetch(`${FILES_API}/${file.id}?alt=media`)
  return (await res.json()) as T
}

export async function writeJson(name: string, data: unknown): Promise<void> {
  const body = JSON.stringify(data)
  const file = await findFile(name)
  const known = versions.get(name)
  if (known !== undefined && (file?.version ?? 'none') !== known) {
    throw new ConflictError(`${name} changed since it was read`)
  }
  let res: Response
  if (file) {
    res = await googleFetch(`${UPLOAD_API}/${file.id}?uploadType=media&fields=version`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
  } else {
    const form = new FormData()
    form.append(
      'metadata',
      new Blob([JSON.stringify({ name, parents: ['appDataFolder'] })], { type: 'application/json' }),
    )
    form.append('file', new Blob([body], { type: 'application/json' }))
    res = await googleFetch(`${UPLOAD_API}?uploadType=multipart&fields=version`, { method: 'POST', body: form })
  }
  const { version } = (await res.json().catch(() => ({}))) as { version?: string }
  if (version) versions.set(name, version)
  else versions.delete(name) // unknown: the next write goes through without a check
}
