import { useEffect } from 'react'
import { useIsFetching, useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ConflictError, readJson, writeJson } from '../google/drive'
import { DRIVE_FILES } from '../google/config'
import { readShifts, saveShifts, windowStart } from './shiftMonths'
import { todayIso } from '../dates'
import { normalizeShift, normalizeWorker, STARTER_DEPARTMENTS, withGeneralCert, withNightPlus } from '../catalog'
import { normalizePendingJob, normalizeShiftRecord } from '../shifts'
import type { ApprovedWord, NewWord, AssistantExample, AssistantNote, Certification, Department, JobType, WorkKind, PendingJob, Place, PostponeReason, Pronunciation, ShiftDefinition, ShiftRecord, Worker, WordGroupSetting } from '../../types/models'

// One Drive appData JSON file = one list (shifts: one file per month). A missing file is an empty list.
// Saves write the whole list, optimistically, and roll back if Drive refuses.
// Saves to one file run one at a time (mutation scope): two whole-list writes in flight
// could land out of order, or both create the file when it does not exist yet.

type ListOf = {
  certifications: Certification
  workers: Worker
  shiftDefinitions: ShiftDefinition
  shifts: ShiftRecord
  pendingJobs: PendingJob
  postponeReasons: PostponeReason
  places: Place
  jobTypes: JobType
  workKinds: WorkKind
  departments: Department
  constraintWords: WordGroupSetting
  assistantNotes: AssistantNote
  assistantExamples: AssistantExample
  pronunciations: Pronunciation
  approvedWords: ApprovedWord
  newWords: NewWord
}
type ListFile = keyof ListOf

// Older files may lack fields added later; fill them on read so the screens can rely on them.
const normalizers: { [K in ListFile]?: (raw: never) => ListOf[K] } = {
  workers: normalizeWorker,
  shiftDefinitions: normalizeShift,
  shifts: normalizeShiftRecord,
  pendingJobs: normalizePendingJob,
}

// Lists whose file was not found on the last read; cleared by the first save.
const missingFiles = new Set<ListFile>()

// Shifts: opening the app reads the last 3 months and every later one. The archive asks once for
// the whole history; from then on every read of the shifts in this tab is the whole history.
let wholeHistory = false

/** For the archive: loads the older months too. True while they are being read. */
export function useWholeHistory(): boolean {
  const qc = useQueryClient()
  useEffect(() => {
    if (wholeHistory) return
    wholeHistory = true
    void qc.invalidateQueries({ queryKey: ['drive', 'shifts'] })
  }, [qc])
  return useIsFetching({ queryKey: ['drive', 'shifts'] }) > 0
}

export function useDriveList<K extends ListFile>(key: K) {
  type T = ListOf[K]
  const qc = useQueryClient()
  const file = DRIVE_FILES[key]

  const query = useQuery({
    queryKey: ['drive', key],
    queryFn: async () => {
      const stored = key === 'shifts' ? await readShifts<ShiftRecord>(wholeHistory ? undefined : windowStart(todayIso())) as T[] | null : await readJson<T[]>(file)
      if (stored === null) missingFiles.add(key)
      else missingFiles.delete(key)
      // No departments file yet: the starter list, written to the file with the first save.
      const raw = stored ?? (key === 'departments' ? (STARTER_DEPARTMENTS as T[]) : [])
      const fix = normalizers[key] as ((r: T) => T) | undefined
      const list = fix ? raw.map(fix) : raw
      // "לינה" and the certification "כללי" always exist; they are written to the file with the next save of their list.
      if (key === 'certifications') return withGeneralCert(list as Certification[]) as T[]
      if (key === 'shiftDefinitions') return withNightPlus(list as ShiftDefinition[]) as T[]
      return list
    },
    staleTime: Infinity,
  })

  const mutation = useMutation({
    mutationKey: ['drive', key],
    scope: { id: `drive-${key}` },
    mutationFn: async (next: T[]) => {
      if (key === 'shifts') {
        // A shift dated into an older month not read yet: that month's shifts join the list.
        const all = await saveShifts(next as ShiftRecord[])
        if (all !== (next as unknown)) qc.setQueryData<T[]>(['drive', key], (cur) => (cur === next ? (all.map(normalizeShiftRecord) as T[]) : cur))
      } else await writeJson(file, next)
      missingFiles.delete(key)
    },
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: ['drive', key] })
      const previous = qc.getQueryData<T[]>(['drive', key])
      qc.setQueryData(['drive', key], next)
      return { previous }
    },
    // Roll back only if no later save has replaced the list in the meantime.
    // Someone else saved this file first: load their version, so the change can be redone on it.
    onError: (e, next, ctx) => {
      if (qc.getQueryData(['drive', key]) === next) qc.setQueryData(['drive', key], ctx?.previous)
      // Shifts: some months may already be saved when another fails, so read back what Drive has.
      if (e instanceof ConflictError || key === 'shifts') void qc.invalidateQueries({ queryKey: ['drive', key] })
    },
  })

  return {
    items: query.data ?? [],
    query,
    missing: query.isSuccess && missingFiles.has(key), // no file yet: nothing was ever saved to this list
    save: mutation.mutateAsync,
    saving: useIsMutating({ mutationKey: ['drive', key] }) > 0, // across every component using this file
  }
}
