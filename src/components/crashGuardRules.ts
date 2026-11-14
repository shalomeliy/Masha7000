// When a new version is published while the app is open, the old version's parts (each screen is
// its own file) are gone from the server. Opening a screen then fails to download it; one reload
// brings the new version. Kept to once a minute, so a real outage does not reload in a loop.

const KEY = 'crashGuard.reloadedAt'

export function isStaleDownload(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /dynamically imported module|Importing a module script failed|error loading dynamically|ChunkLoadError/i.test(text)
}

export function reloadOnceForStaleDownload(now = Date.now(), store: Pick<Storage, 'getItem' | 'setItem'> = sessionStorage, reload = () => window.location.reload()): boolean {
  try {
    const last = Number(store.getItem(KEY) ?? 0)
    if (now - last < 60_000) return false
    store.setItem(KEY, String(now))
  } catch {
    return false
  }
  reload()
  return true
}
