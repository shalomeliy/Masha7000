import { open, seal } from './crypto.js'
import type { Env } from './env.js'
import { refreshAccess } from './google.js'
import { KEYS, kv } from './kv.js'

// The owner's Drive appDataFolder, from the server: the same JSON files the app reads and writes
// (src/lib/google/drive.ts), opened with the owner's stored refresh token. Used by /api/token (to hand
// a token to the app) and by the outside API (/api/v1).
// A write checks, just before it uploads, that the file is still the one this request read: same
// content (md5), or absent when it was absent. Otherwise DriveConflict, nothing written. The small
// window between that check and the upload is the same one the app accepts.

const FILES = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'

export class DriveConflict extends Error {}
export class DriveFailed extends Error {}

interface Cached {
  token: string
  exp: number
}

export type OwnerToken = { token: string; expiresIn: number } | { reason: 'owner-disconnected' | 'google-failed' }

/** A 1-hour access token for the owner's Drive and calendar, cached in the store. `stale`: Google refused the cached one. */
export async function ownerToken(env: Env, stale = false): Promise<OwnerToken> {
  const cached = stale ? null : await open<Cached>(env.sessionKey, await kv.get(env, KEYS.access))
  if (cached && cached.exp - Date.now() > 120_000) return { token: cached.token, expiresIn: Math.floor((cached.exp - Date.now()) / 1000) }
  const refresh = await open<string>(env.sessionKey, await kv.get(env, KEYS.refresh))
  if (!refresh) return { reason: 'owner-disconnected' }
  const { ok, data } = await refreshAccess(env, refresh)
  if (!ok || !data.access_token) {
    if (data.error === 'invalid_grant') {
      // The owner removed the app's access in Google, or the token expired: everyone needs the owner to reconnect.
      await kv.del(env, KEYS.refresh, KEYS.access)
      return { reason: 'owner-disconnected' }
    }
    return { reason: 'google-failed' }
  }
  const expiresIn = data.expires_in ?? 3600
  await kv.set(env, KEYS.access, await seal(env.sessionKey, { token: data.access_token, exp: Date.now() + expiresIn * 1000 } satisfies Cached), expiresIn - 60)
  return { token: data.access_token, expiresIn }
}

interface FoundFile {
  id: string
  md5Checksum?: string
}

/** What a read saw of one file: its content as text, or null when there was no such file. */
export interface Read<T> {
  name: string
  id: string | null
  md5: string | null
  text: string | null
  data: T | null
}

export class Drive {
  private token: string
  constructor(token: string) {
    this.token = token
  }

  private async call(url: string, init: RequestInit = {}) {
    const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${this.token}` } })
    if (!res.ok) throw new DriveFailed(`drive ${res.status}`)
    return res
  }

  private async find(name: string): Promise<FoundFile | null> {
    const q = encodeURIComponent(`name = '${name}' and trashed = false`)
    const res = await this.call(`${FILES}?spaces=appDataFolder&q=${q}&orderBy=createdTime&fields=files(id,md5Checksum)`)
    return ((await res.json()) as { files: FoundFile[] }).files[0] ?? null
  }

  private async download(id: string) {
    return (await this.call(`${FILES}/${id}?alt=media`)).text()
  }

  async read<T>(name: string): Promise<Read<T>> {
    const file = await this.find(name)
    if (!file) return { name, id: null, md5: null, text: null, data: null }
    const text = await this.download(file.id)
    return { name, id: file.id, md5: file.md5Checksum ?? null, text, data: JSON.parse(text) as T }
  }

  /** Names of this app's files that contain `contains` and match. */
  async names(contains: string, match: RegExp): Promise<string[]> {
    const q = encodeURIComponent(`name contains '${contains}' and trashed = false`)
    const out: string[] = []
    let page = ''
    do {
      const res = await this.call(`${FILES}?spaces=appDataFolder&q=${q}&pageSize=1000&fields=nextPageToken,files(name)${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`)
      const data = (await res.json()) as { files: { name: string }[]; nextPageToken?: string }
      out.push(...data.files.map((f) => f.name).filter((n) => match.test(n)))
      page = data.nextPageToken ?? ''
    } while (page)
    return [...new Set(out)].sort()
  }

  /** Writes `data` over the file `before` read; DriveConflict when someone changed it since. */
  async write(before: Read<unknown>, data: unknown): Promise<void> {
    const now = await this.find(before.name)
    if ((now === null) !== (before.id === null)) throw new DriveConflict(before.name)
    if (now && before.id) {
      const same = now.md5Checksum && before.md5 ? now.md5Checksum === before.md5 : (await this.download(now.id)) === before.text
      if (!same) throw new DriveConflict(before.name)
    }
    const body = JSON.stringify(data)
    if (now) {
      await this.call(`${UPLOAD}/${now.id}?uploadType=media&fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body })
      return
    }
    const form = new FormData()
    form.append('metadata', new Blob([JSON.stringify({ name: before.name, parents: ['appDataFolder'] })], { type: 'application/json' }))
    form.append('file', new Blob([body], { type: 'application/json' }))
    await this.call(`${UPLOAD}?uploadType=multipart&fields=id`, { method: 'POST', body: form })
  }
}
