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

// All of the app's files in one listing, shared by the reads that start together (opening the app
// reads about 16 lists and the months of shifts at once: one listing instead of one search each).
// It is used only while fresh: an older listing could hold a version someone has changed since, and
// that version is the baseline of the conflict check. Any write here drops it.
const FRESH_MS = 5000
let index: { at: number; files: Promise<Map<string, FoundFile & { name: string }>> } | null = null

function listAll(): Promise<Map<string, FoundFile & { name: string }>> {
  if (index && Date.now() - index.at < FRESH_MS) return index.files
  const files = (async () => {
    const q = encodeURIComponent('trashed = false')
    const all = new Map<string, FoundFile & { name: string }>()
    let pageToken = ''
    do {
      const res = await googleFetch(
        `${FILES_API}?spaces=appDataFolder&q=${q}&orderBy=createdTime&pageSize=1000&fields=nextPageToken,files(id,name,version,md5Checksum)${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
      )
      const data: { files: (FoundFile & { name: string })[]; nextPageToken?: string } = await res.json()
      // The oldest file of a name wins, as in findFile.
      for (const f of data.files) if (!all.has(f.name)) all.set(f.name, f)
      pageToken = data.nextPageToken ?? ''
    } while (pageToken)
    return all
  })()
  const entry = { at: Date.now(), files }
  index = entry
  files.catch(() => {
    if (index === entry) index = null
  })
  return files
}

/** The next read lists the folder again (after this screen changed it). */
const dropIndex = () => {
  index = null
}

const listed = async (name: string): Promise<FoundFile | null> => (await listAll()).get(name) ?? null

function remember(name: string, version: string | undefined, md5: string | undefined) {
  if (version) versions.set(name, version)
  else versions.delete(name) // unknown: the next write goes through without a check
  if (md5) checksums.set(name, md5)
  else checksums.delete(name)
}

export async function readJson<T>(name: string): Promise<T | null> {
  const file = await listed(name)
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
  dropIndex()
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
  dropIndex()
  bodies.set(name, body)
  remember(name, version, md5Checksum)
}

/** Names of this app's files that match, for lists kept in several files (shifts by month). */
export async function listNames(contains: string, match: RegExp): Promise<string[]> {
  return [...(await listAll()).keys()].filter((n) => n.includes(contains) && match.test(n))
}

/** Gives a file another name, keeping its content; false when there was no such file. */
export async function renameFile(name: string, to: string): Promise<boolean> {
  dropIndex()
  const file = await findFile(name)
  if (!file) return false
  await googleFetch(`${FILES_API}/${file.id}?fields=id`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: to }),
  })
  dropIndex()
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
  const file = await listed(name)
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
  dropIndex()
  await googleFetch(`${UPLOAD_API}?uploadType=multipart&fields=id`, { method: 'POST', body: form })
  dropIndex()
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
  dropIndex()
  await googleFetch(`${FILES_API}/${id}`, { method: 'DELETE' })
  dropIndex()
}
