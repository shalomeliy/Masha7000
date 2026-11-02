import { googleFetch } from './auth'

// JSON files in the owner's Drive appDataFolder: hidden from the user, visible only to this app.
// Several people can edit the same files, so each write checks that the file's Drive version is
// still the one this screen read; if someone else saved in between, the write is refused
// (ConflictError) instead of silently erasing their change. A small window between the check
// and the write remains; with two or three managers that is accepted.
// Drive also raises a file's version on its own shortly after an upload, so the version saved
// from the write's answer can be outdated by the next save. A changed version therefore only
// counts as a conflict when the file's content changed too. Drive's md5Checksum of the content
// tells that without downloading the file; only when it is missing is the file downloaded to compare.

const FILES_API = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files'

export class ConflictError extends Error {}

/** Drive version of each file as last read or written here; 'none' = the file did not exist. */
const versions = new Map<string, string>()
/** File content as last read or written here, to tell a real change from a bare version bump. */
const bodies = new Map<string, string>()
/** Drive's md5 of that content, when Drive gave one. */
const checksums = new Map<string, string>()

interface FoundFile {
  id: string
  version: string
  md5Checksum?: string
}

async function findFile(name: string): Promise<FoundFile | null> {
  const q = encodeURIComponent(`name = '${name}' and trashed = false`)
  const res = await googleFetch(`${FILES_API}?spaces=appDataFolder&q=${q}&orderBy=createdTime&fields=files(id,version,md5Checksum)`)
  const data: { files: FoundFile[] } = await res.json()
  return data.files[0] ?? null
}

function remember(name: string, version: string | undefined, md5: string | undefined) {
  if (version) versions.set(name, version)
  else versions.delete(name) // unknown: the next write goes through without a check
  if (md5) checksums.set(name, md5)
  else checksums.delete(name)
}

export async function readJson<T>(name: string): Promise<T | null> {
  const file = await findFile(name)
  versions.set(name, file?.version ?? 'none')
  checksums.delete(name)
  if (!file) return null
  const text = await download(file.id)
  bodies.set(name, text)
  remember(name, file.version, file.md5Checksum)
  return JSON.parse(text) as T
}

async function download(id: string): Promise<string> {
  const res = await googleFetch(`${FILES_API}/${id}?alt=media`)
  return res.text()
}

export async function writeJson(name: string, data: unknown): Promise<void> {
  const body = JSON.stringify(data)
  const file = await findFile(name)
  const known = versions.get(name)
  if (known !== undefined && (file?.version ?? 'none') !== known) {
    const md5 = checksums.get(name)
    const sameContent =
      file !== null &&
      known !== 'none' &&
      (md5 && file.md5Checksum ? file.md5Checksum === md5 : (await download(file.id)) === bodies.get(name))
    if (!sameContent) throw new ConflictError(`${name} changed since it was read`)
  }
  let res: Response
  if (file) {
    res = await googleFetch(`${UPLOAD_API}/${file.id}?uploadType=media&fields=version,md5Checksum`, {
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
    res = await googleFetch(`${UPLOAD_API}?uploadType=multipart&fields=version,md5Checksum`, { method: 'POST', body: form })
  }
  const { version, md5Checksum } = (await res.json().catch(() => ({}))) as { version?: string; md5Checksum?: string }
  bodies.set(name, body)
  remember(name, version, md5Checksum)
}

/** Names of this app's files that match, for lists kept in several files (shifts by month). */
export async function listNames(contains: string, match: RegExp): Promise<string[]> {
  const q = encodeURIComponent(`name contains '${contains}' and trashed = false`)
  const names: string[] = []
  let pageToken = ''
  do {
    const res = await googleFetch(
      `${FILES_API}?spaces=appDataFolder&q=${q}&pageSize=1000&fields=nextPageToken,files(name)${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
    )
    const data: { files: { name: string }[]; nextPageToken?: string } = await res.json()
    names.push(...data.files.map((f) => f.name).filter((n) => match.test(n)))
    pageToken = data.nextPageToken ?? ''
  } while (pageToken)
  return names
}

/** Gives a file another name, keeping its content; false when there was no such file. */
export async function renameFile(name: string, to: string): Promise<boolean> {
  const file = await findFile(name)
  if (!file) return false
  await googleFetch(`${FILES_API}/${file.id}?fields=id`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: to }),
  })
  forgetVersions([name])
  return true
}

// ---- Backup copies: whole files of their own, never edited, so no version check ----

export interface DriveCopy {
  id: string
  name: string
  createdTime: string
  appProperties?: Record<string, string>
}

/** Reads a list without becoming this screen's baseline for the conflict check. */
export async function peekJson<T>(name: string): Promise<T | null> {
  const file = await findFile(name)
  return file ? (JSON.parse(await download(file.id)) as T) : null
}

export async function listCopies(prefix: string): Promise<DriveCopy[]> {
  const q = encodeURIComponent(`name contains '${prefix}' and trashed = false`)
  const res = await googleFetch(
    `${FILES_API}?spaces=appDataFolder&q=${q}&orderBy=createdTime desc&pageSize=100&fields=files(id,name,createdTime,appProperties)`,
  )
  const data: { files: DriveCopy[] } = await res.json()
  return data.files
}

export async function createCopy(name: string, body: string, appProperties: Record<string, string>): Promise<void> {
  const form = new FormData()
  form.append(
    'metadata',
    new Blob([JSON.stringify({ name, parents: ['appDataFolder'], appProperties })], { type: 'application/json' }),
  )
  form.append('file', new Blob([body], { type: 'application/json' }))
  await googleFetch(`${UPLOAD_API}?uploadType=multipart&fields=id`, { method: 'POST', body: form })
}

export const readCopy = (id: string) => download(id)

/** A file this screen never read is taken as absent: if it exists by the time of the write, that is a conflict. */
export function expectAbsent(name: string) {
  if (!versions.has(name)) versions.set(name, 'none')
}

/** The next write of these files goes through without the conflict check (a restore the manager confirmed again). */
export function forgetVersions(names: string[]) {
  for (const n of names) {
    versions.delete(n)
    checksums.delete(n)
  }
}

export async function deleteCopy(id: string): Promise<void> {
  await googleFetch(`${FILES_API}/${id}`, { method: 'DELETE' })
}
