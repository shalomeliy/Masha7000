import { tx } from '../i18n'
import { useState } from 'react'
import { CalendarPlus, Trash2 } from 'lucide-react'
import { DictationField } from '../components/DictationField'
import { DriveError } from '../components/DriveError'
import { Field, inputClass, Sheet, SheetActions } from '../components/Sheet'
import { Suggestions } from '../components/Suggestions'
import { defaultShiftDef, nameError, newId, staffingFor, staffingText, tagNames, upsert } from '../lib/catalog'
import { useDriveList } from '../lib/data/useDriveList'
import { todayIso } from '../lib/dates'
import { fullNames } from '../lib/pinnedDates'
import type { GapContext } from '../lib/gaps'
import { PinnedField } from './calendar/PinnedField'
import { blankShift, dayName, isWaiting, showDate, STARTER_POSTPONE_REASONS, taskHistory } from '../lib/shifts'
import type { PendingJob, PostponeReason, ShiftRecord } from '../types/models'
import { OUTCOMES } from './calendar/outcomes'
import { ShiftSheet } from './calendar/ShiftEditor'
import { ShiftDefField } from './calendar/ShiftDefField'
import { StaffingField } from './calendar/StaffingField'
import { VehiclePick } from './calendar/VehiclePick'
import { WorkKindField } from './calendar/WorkKindField'
import { toggleKind } from '../lib/workKinds'
import { AddButton, EditMark, EmptyState } from './workers/common'
import { asTaskList } from '../lib/taskList'
import { jobVehicleText } from '../lib/vehicles'

// Jobs that still need a day (left over from partial or postponed night jobs), shown at the top of the
// calendar, and the manager's list of postpone reasons (Settings). Until 2026-11-13 they had their own
// bottom tab, "לשיבוץ"; the user removed it, and the jobs kept in the file show in the calendar.

export function WaitingJobs() {
  const jobs = useDriveList('pendingJobs')
  const workers = useDriveList('workers')
  const reasons = useDriveList('postponeReasons')
  const shifts = useDriveList('shifts')
  const certs = useDriveList('certifications')
  const defs = useDriveList('shiftDefinitions')
  const vehicles = useDriveList('vehicles')
  // Newest first: the job added last is on top.
  const waiting = jobs.items.filter((j) => isWaiting(j, shifts.items)).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  const [editing, setEditing] = useState<PendingJob | null>(null)
  const [scheduling, setScheduling] = useState<ShiftRecord | null>(null)

  if (!waiting.length) return null
  return (
    <>
      <details className="rounded-2xl border border-amber-500/50 bg-amber-500/10">
        <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-4 font-semibold text-amber-200">
          <CalendarPlus size={18} aria-hidden />
          {waiting.length === 1 ? tx('עבודה אחת מחכה ליום') : tx('{n} עבודות מחכות ליום', { n: waiting.length })}
        </summary>
        <ul className="space-y-2 px-3 pb-3">
            {waiting.map((j) => {
              const outcome = OUTCOMES.find((o) => o.id === j.outcome)
              const why = [tagNames(j.reasonIds, reasons.items).join(', '), j.note].filter(Boolean).join(' · ')
              const def = defs.items.find((d) => d.id === j.shiftDefinitionId)
              return (
                <li key={j.id} className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
                  <button type="button" onClick={() => setEditing(j)} className="relative w-full space-y-1 p-4 pe-9 text-start">
                    <EditMark />
                    <span className="flex flex-wrap items-center gap-2 text-xs">
                      {j.followUp ? (
                        <span className="rounded-full border border-sky-500 bg-sky-500/15 px-2 py-0.5 font-semibold text-sky-200">{tx('משימת המשך')}</span>
                      ) : (
                        outcome && <span className={`rounded-full border px-2 py-0.5 font-semibold ${outcome.tone}`}>{outcome.label}</span>
                      )}
                      {def && <span className="rounded-full border border-slate-600 px-2 py-0.5 font-semibold text-slate-200">{def.name}</span>}
                      {j.createdAt && <span className="text-slate-400">{tx('מ-{v}', { v: showDate(todayIso(new Date(j.createdAt))) })}</span>}
                    </span>
                    {j.location && <span className="block font-semibold">{j.location}</span>}
                    {j.jobDescription && <span className="block whitespace-pre-line text-sm text-slate-300">{j.jobDescription}</span>}
                    {why && <span className="block text-sm text-slate-400">{why}</span>}
                    {!!j.pinnedIds?.length && (
                      <span className="block text-sm text-emerald-300">
                        {tx('חייבים להיות: {v}', { v: fullNames(j.pinnedIds, workers.items).join(', ') })}
                      </span>
                    )}
                    {(j.vehicleId || j.vehicleType) && <span className="block text-sm text-slate-400">{tx('רכב: {v}', { v: jobVehicleText(j, vehicles.items) })}</span>}
                    <span className="block text-sm text-slate-400">
                      {tx('צריך {v}', { v: staffingText(staffingFor(j.staffing, certs.items.map((c) => c.id)), certs.items) })}</span>
                  </button>
                  <TaskHistory job={j} />
                  <JobCardActions job={j} onSchedule={() => setScheduling(blankShift(todayIso(), j))} />
                </li>
              )
            })}
        </ul>
      </details>

      <Sheet open={editing !== null} title={editing && jobs.items.some((j) => j.id === editing.id) ? tx('עריכת עבודה') : tx('עבודה חדשה')} onClose={() => setEditing(null)} locked={jobs.saving}>
        {editing && <JobForm job={editing} onDone={() => setEditing(null)} onSchedule={setScheduling} />}
      </Sheet>
      <ShiftSheet editing={scheduling} onClose={() => setScheduling(null)} />
    </>
  )
}

// The card's bottom row: schedule it, or delete it after a second tap that asks first.
function JobCardActions({ job, onSchedule }: { job: PendingJob; onSchedule: () => void }) {
  const jobs = useDriveList('pendingJobs')
  const [confirming, setConfirming] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)

  const remove = async () => {
    setSaveError(null)
    try {
      await jobs.save(jobs.items.filter((j) => j.id !== job.id))
    } catch (e) {
      setSaveError(e)
    }
  }

  if (confirming)
    return (
      <div className="space-y-3 border-t border-red-500/40 bg-red-500/10 p-3">
        <p className="text-sm text-red-200">{tx('למחוק את העבודה מהרשימה? היא לא תחכה יותר לשיבוץ.')}</p>
        {saveError != null && <DriveError error={saveError} action="save" />}
        <div className="flex gap-2">
          <button type="button" disabled={jobs.saving} onClick={remove} className="min-h-11 flex-1 rounded-xl bg-red-500 font-semibold text-slate-950 disabled:opacity-50">
            {jobs.saving ? tx('מוחק...') : tx('כן, למחוק')}
          </button>
          <button type="button" disabled={jobs.saving} onClick={() => setConfirming(false)} className="min-h-11 flex-1 rounded-xl border border-slate-700 text-slate-300 disabled:opacity-50">
            {tx('לא')}
          </button>
        </div>
      </div>
    )

  return (
    <div className="flex border-t border-slate-800">
      <button type="button" onClick={onSchedule} className="flex min-h-12 flex-1 items-center gap-2 px-4 text-sm font-semibold text-sky-400">
        <CalendarPlus size={18} aria-hidden />
        {tx('שיבוץ ביומן')}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="flex min-h-12 items-center gap-2 border-s border-slate-800 px-4 text-sm font-semibold text-red-300"
      >
        <Trash2 size={18} aria-hidden />
        {tx('מחיקה')}
      </button>
    </div>
  )
}

// The earlier steps of a task, oldest first: each shift it went through and how it ended.
function TaskHistory({ job }: { job: PendingJob }) {
  const jobs = useDriveList('pendingJobs')
  const shifts = useDriveList('shifts')
  const reasons = useDriveList('postponeReasons')
  const steps = taskHistory(job, shifts.items, jobs.items)
  if (!steps.length) return null
  const first = steps[0].shift

  return (
    <details className="border-t border-slate-800 px-4 py-2 text-sm">
      <summary className="flex min-h-10 cursor-pointer items-center text-slate-300">
        {steps.length === 1 ? tx('מקושרת למשימה מ-{v}', { v: showDate(first.date) }) : tx('מקושרת ל-{length} משימות קודמות, מ-{v}', { length: steps.length, v: showDate(first.date) })}
      </summary>
      <ol className="space-y-2 border-s border-slate-700 ps-3 pt-1">
        {steps.map(({ shift: s }) => {
          const outcome = OUTCOMES.find((o) => o.id === s.closure?.outcome)
          const why = s.closure ? [tagNames(s.closure.reasonIds, reasons.items).join(', '), s.closure.note].filter(Boolean).join(' · ') : ''
          return (
            <li key={s.id} className="space-y-0.5">
              <span className="block text-xs text-slate-400">
                {tx('יום {weekday} {v2}{v3}', { weekday: dayName(s.date), v2: showDate(s.date), v3: s.location && ` · ${s.location}` })}</span>
              {s.jobDescription && <span className="block whitespace-pre-line text-slate-200">{s.jobDescription}</span>}
              {outcome && (
                <span className="block text-xs">
                  <span className={`rounded-full border px-2 py-0.5 font-semibold ${outcome.tone}`}>{outcome.label}</span>
                  {why && <span className="ms-2 text-slate-400">{why}</span>}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </details>
  )
}

function JobForm({ job, onDone, onSchedule }: { job: PendingJob; onDone: () => void; onSchedule: (shift: ShiftRecord) => void }) {
  const jobs = useDriveList('pendingJobs')
  const workers = useDriveList('workers')
  const shifts = useDriveList('shifts')
  const certs = useDriveList('certifications')
  const defs = useDriveList('shiftDefinitions')
  // A new job starts as "יום", like a new shift in the calendar.
  const [draft, setDraft] = useState(() => ({
    ...job,
    shiftDefinitionId: job.shiftDefinitionId ?? defaultShiftDef(defs.items)?.id,
    staffing: staffingFor(job.staffing, certs.items.map((c) => c.id)),
  }))
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const exists = jobs.items.some((j) => j.id === job.id)

  const write = async (next: PendingJob[]) => {
    setBusy(true)
    setSaveError(null)
    try {
      await jobs.save(next)
      onDone()
    } catch (e) {
      setSaveError(e)
    } finally {
      setBusy(false)
    }
  }

  const cleaned = () => {
    const clean = { ...draft, location: draft.location.trim(), jobDescription: asTaskList(draft.jobDescription), note: draft.note?.trim() || undefined, pinnedIds: draft.pinnedIds?.length ? draft.pinnedIds : undefined }
    const err = clean.location || clean.jobDescription ? null : tx('צריך למלא מיקום או מהות עבודה')
    setError(err)
    return err ? null : clean
  }
  const save = () => {
    const clean = cleaned()
    if (clean) write(upsert(jobs.items, clean))
  }

  // Workers the job must have, and the nearest days they are all free: picking one saves the job and opens it as a shift on that day.
  const ctx: GapContext = { workers: workers.items, records: shifts.items, defs: defs.items, certifications: certs.items }
  const pinnedShift: ShiftRecord = {
    ...blankShift(todayIso(), draft),
    crew: (draft.pinnedIds ?? []).filter((workerId) => workers.items.some((x) => x.id === workerId)).map((workerId) => ({ workerId })),
  }
  const scheduleOn = async (shift: ShiftRecord) => {
    const clean = cleaned()
    if (!clean) return
    setBusy(true)
    setSaveError(null)
    try {
      await jobs.save(upsert(jobs.items, clean))
      onDone()
      onSchedule(shift)
    } catch (e) {
      setSaveError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ShiftDefField value={draft.shiftDefinitionId} onChange={(shiftDefinitionId) => setDraft((d) => ({ ...d, shiftDefinitionId }))} />
      <Field label={tx('מיקום')}>
        <input autoFocus value={draft.location} onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))} className={inputClass} />
      </Field>
      <Suggestions list="places" value={draft.location} onPick={(location) => setDraft((d) => ({ ...d, location }))} />
      <DictationField label={tx('מהות העבודה')} value={draft.jobDescription} tasks onChange={(v) => setDraft((d) => ({ ...d, jobDescription: v }))} />
      <Suggestions list="jobTypes" value={draft.jobDescription} onPick={(jobDescription) => setDraft((d) => ({ ...d, jobDescription }))} />
      <WorkKindField value={draft.workKindIds} onToggle={(kind) => setDraft((d) => ({ ...d, ...toggleKind(d, kind) }))} />
      <VehiclePick value={draft} onChange={(v) => setDraft((d) => ({ ...d, ...v }))} />
      <StaffingField value={draft.staffing} onChange={(staffing) => setDraft((d) => ({ ...d, staffing }))} />
      {workers.items.length > 0 && (
        <PinnedField draft={pinnedShift} ctx={ctx} onChange={(next) => setDraft((d) => ({ ...d, pinnedIds: next.pinnedIds }))} onPick={(o) => void scheduleOn(o.shift)} />
      )}
      <DictationField label={tx('הערות')} value={draft.note ?? ''} onChange={(v) => setDraft((d) => ({ ...d, note: v }))} />
      <SheetActions
        onSave={save}
        onCancel={onDone}
        onDelete={exists ? () => write(jobs.items.filter((j) => j.id !== job.id)) : undefined}
        deleteWarning={tx('למחוק את העבודה מהרשימה? היא לא תחכה יותר לשיבוץ.')}
        busy={busy}
        error={error}
        saveError={saveError}
      />
    </>
  )
}

export function ReasonsSection() {
  const reasons = useDriveList('postponeReasons')
  const [editing, setEditing] = useState<PostponeReason | null>(null)
  const [starterError, setStarterError] = useState<unknown>(null)

  const addStarter = async () => {
    setStarterError(null)
    try {
      await reasons.save(STARTER_POSTPONE_REASONS.map((name) => ({ id: newId(), name })))
    } catch (e) {
      setStarterError(e)
    }
  }

  return (
    <>
      {reasons.items.length === 0 ? (
        <EmptyState
          text={tx('סיבות דחייה הן הרשימה שממנה תבחר כשעבודת לילה נדחית.')}
          addLabel={tx('הוספת סיבה')}
          onAdd={() => setEditing({ id: newId(), name: '' })}
          starterLabel={tx('להתחיל עם: {v}', { v: STARTER_POSTPONE_REASONS.join(', ') })}
          onStarter={addStarter}
          starterBusy={reasons.saving}
          starterError={starterError}
        />
      ) : (
        <>
          <ul className="space-y-2">
            {reasons.items.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setEditing(r)}
                  className="relative flex min-h-14 w-full items-center rounded-2xl border border-slate-800 bg-slate-900 px-4 py-2 pe-9 text-start font-semibold"
                >
                  <EditMark />
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
          <AddButton label={tx('הוספת סיבה')} onClick={() => setEditing({ id: newId(), name: '' })} />
        </>
      )}
      <Sheet open={editing !== null} title={editing && reasons.items.some((r) => r.id === editing.id) ? tx('עריכת סיבה') : tx('סיבה חדשה')} onClose={() => setEditing(null)} locked={reasons.saving}>
        {editing && <ReasonForm reason={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </>
  )
}

function ReasonForm({ reason, onDone }: { reason: PostponeReason; onDone: () => void }) {
  const reasons = useDriveList('postponeReasons')
  const [name, setName] = useState(reason.name)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const exists = reasons.items.some((r) => r.id === reason.id)

  const write = async (next: PostponeReason[]) => {
    setBusy(true)
    setSaveError(null)
    try {
      await reasons.save(next)
      onDone()
    } catch (e) {
      setSaveError(e)
    } finally {
      setBusy(false)
    }
  }

  const save = () => {
    const err = nameError(name, reasons.items, reason.id)
    setError(err)
    if (!err) write(upsert(reasons.items, { ...reason, name: name.trim() }))
  }

  return (
    <>
      <Field label={tx('הסיבה')}>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </Field>
      <SheetActions
        onSave={save}
        onCancel={onDone}
        // Closed jobs keep the id; a deleted reason just stops showing on them.
        onDelete={exists ? () => write(reasons.items.filter((r) => r.id !== reason.id)) : undefined}
        deleteWarning={tx('למחוק את הסיבה מהרשימה? בעבודות שכבר נסגרו עם הסיבה הזו היא לא תוצג יותר.')}
        busy={busy}
        error={error}
        saveError={saveError}
      />
    </>
  )
}
