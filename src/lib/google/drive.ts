import { googleFetch } from './auth'

// JSON files in the user's Drive appDataFolder: hidden from the user, visible only to this app.

const FILES_API = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files'

async function findFileId(name: string): Promise<string | null> {
  const q = encodeURIComponent(`name = '${name}' and trashed = false`)
  const res = await googleFetch(`${FILES_API}?spaces=appDataFolder&q=${q}&fields=files(id)`)
  const data: { files: { id: string }[] } = await res.json()
  return data.files[0]?.id ?? null
}

export async function readJson<T>(name: string): Promise<T | null> {
  const id = await findFileId(name)
  if (!id) return null
  const res = await googleFetch(`${FILES_API}/${id}?alt=media`)
  return (await res.json()) as T
}

export async function writeJson(name: string, data: unknown): Promise<void> {
  const body = JSON.stringify(data)
  const id = await findFileId(name)
  if (id) {
    await googleFetch(`${UPLOAD_API}/${id}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    return
  }
  const form = new FormData()
  form.append(
    'metadata',
    new Blob([JSON.stringify({ name, parents: ['appDataFolder'] })], { type: 'application/json' }),
  )
  form.append('file', new Blob([body], { type: 'application/json' }))
  await googleFetch(`${UPLOAD_API}?uploadType=multipart`, { method: 'POST', body: form })
}
