import { useEffect } from 'react'
import { starterKinds } from '../workKinds'
import { useDriveList } from './useDriveList'

// The first time the app is used with work kinds (no file yet), "טיפוס" and "ריתוך" are written,
// with the certifications they need that are missing. Once: deleting them later is kept.
let started = false

export function useStarterWorkKinds() {
  const kinds = useDriveList('workKinds')
  const certs = useDriveList('certifications')
  const ready = kinds.missing && kinds.query.isSuccess && certs.query.isSuccess
  useEffect(() => {
    if (!ready || started) return
    started = true
    const s = starterKinds(certs.items)
    void (async () => {
      try {
        // The certifications first, so a kind never points at a missing one.
        if (s.certs.length) await certs.save([...certs.items, ...s.certs])
        await kinds.save(s.kinds)
      } catch {
        started = false // tried again the next time a screen with kinds opens
      }
    })()
  }, [ready, certs, kinds])
}
