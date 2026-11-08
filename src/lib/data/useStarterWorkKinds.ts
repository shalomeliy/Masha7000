import { useEffect } from 'react'
import { repairKinds, starterKinds } from '../workKinds'
import { useDriveList } from './useDriveList'

// The first time the app is used with work kinds (no file yet), "טיפוס" and "ריתוך" are written,
// with the roles and certification they need that are missing. Once: deleting them later is kept.
// Kinds already saved are repaired once per load (see `repairKinds`), so older files fix themselves.
let started = false
let repaired = false

export function useStarterWorkKinds() {
  const kinds = useDriveList('workKinds')
  const roles = useDriveList('roles')
  const certs = useDriveList('certifications')
  const loaded = kinds.query.isSuccess && roles.query.isSuccess && certs.query.isSuccess
  const ready = kinds.missing && loaded
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

  const repairable = loaded && !kinds.missing && !kinds.saving && !roles.saving
  useEffect(() => {
    if (!repairable || repaired) return
    repaired = true
    const next = repairKinds(kinds.items, roles.items)
    if (!next) return
    kinds.save(next).catch(() => {
      repaired = false // tried again the next time a screen with kinds opens
    })
  }, [repairable, kinds, roles])
}
