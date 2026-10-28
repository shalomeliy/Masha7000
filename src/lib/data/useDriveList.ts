import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { readJson, writeJson } from '../google/drive'
import { DRIVE_FILES } from '../google/config'
import { normalizeShift, normalizeWorker } from '../catalog'
import { normalizePendingJob, normalizeShiftRecord } from '../shifts'
import type { Certification, PendingJob, PostponeReason, Role, ShiftDefinition, ShiftRecord, Worker } from '../../types/models'

// One Drive appData JSON file = one list. A missing file is an empty list.
// Saves write the whole list, optimistically, and roll back if Drive refuses.
// Saves to one file run one at a time (mutation scope): two whole-list writes in flight
// could land out of order, or both create the file when it does not exist yet.

type ListOf = {
  roles: Role
  certifications: Certification
  workers: Worker
  shiftDefinitions: ShiftDefinition
  shifts: ShiftRecord
  pendingJobs: PendingJob
  postponeReasons: PostponeReason
}
type ListFile = keyof ListOf

// Older files may lack fields added later; fill them on read so the screens can rely on them.
const normalizers: { [K in ListFile]?: (raw: never) => ListOf[K] } = {
  workers: normalizeWorker,
  shiftDefinitions: normalizeShift,
  shifts: normalizeShiftRecord,
  pendingJobs: normalizePendingJob,
}

export function useDriveList<K extends ListFile>(key: K) {
  type T = ListOf[K]
  const qc = useQueryClient()
  const file = DRIVE_FILES[key]

  const query = useQuery({
    queryKey: ['drive', key],
    queryFn: async () => {
      const raw = (await readJson<T[]>(file)) ?? []
      const fix = normalizers[key] as ((r: T) => T) | undefined
      return fix ? raw.map(fix) : raw
    },
    staleTime: Infinity,
  })

  const mutation = useMutation({
    mutationKey: ['drive', key],
    scope: { id: `drive-${key}` },
    mutationFn: (next: T[]) => writeJson(file, next),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: ['drive', key] })
      const previous = qc.getQueryData<T[]>(['drive', key])
      qc.setQueryData(['drive', key], next)
      return { previous }
    },
    // Roll back only if no later save has replaced the list in the meantime.
    onError: (_e, next, ctx) => {
      if (qc.getQueryData(['drive', key]) === next) qc.setQueryData(['drive', key], ctx?.previous)
    },
  })

  return {
    items: query.data ?? [],
    query,
    save: mutation.mutateAsync,
    saving: useIsMutating({ mutationKey: ['drive', key] }) > 0, // across every component using this file
  }
}
