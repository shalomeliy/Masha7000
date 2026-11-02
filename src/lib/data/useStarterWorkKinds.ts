import { useEffect } from 'react'
import { starterKinds } from '../workKinds'
import { useDriveList } from './useDriveList'

// The first time the app is used with work kinds (no file yet), "טיפוס" and "ריתוך" are written,
// with the roles and certification they need that are missing. Once: deleting them later is kept.
let started = false

export function useStarterWorkKinds() {
  const kinds = useDriveList('workKinds')
  const roles = useDriveList('roles')
  const certs = useDriveList('certifications')
  const ready = kinds.missing && roles.query.isSuccess && certs.query.isSuccess
  useEffect(() => {
    if (!ready || started) return
    started = true
    const s = starterKinds(roles.items, certs.items)
    void (async () => {
      try {
        // The roles and certification first, so a kind never points at a missing one.
        if (s.certs.length) await certs.save([...certs.items, ...s.certs])
        if (s.roles.length) await roles.save([...roles.items, ...s.roles])
        await kinds.save(s.kinds)
      } catch {
        started = false // tried again the next time a screen with kinds opens
      }
    })()
  }, [ready, roles, certs, kinds])
}
