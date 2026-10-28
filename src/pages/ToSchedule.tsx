import { useState } from 'react'
import { CalendarPlus, Loader2 } from 'lucide-react'
import { DictationField } from '../components/DictationField'
import { DriveError } from '../components/DriveError'
import { Field, inputClass, Sheet, SheetActions } from '../components/Sheet'
import { nameError, newId, tagNames, upsert } from '../lib/catalog'
import { useDriveList } from '../lib/data/useDriveList'
import { todayIso } from '../lib/dates'
import { blankShift, dayName, isWaiting, showDate, STARTER_POSTPONE_REASONS, taskHistory } from '../lib/shifts'
import type { PendingJob, PostponeReason, ShiftRecord } from '../types/models'
import { OUTCOMES } from './calendar/outcomes'
import { ShiftSheet } from './calendar/ShiftEditor'
import { AddButton, EditMark, EmptyState } from './workers/common'

// "לשיבוץ": jobs that still need a shift (left over from partial or postponed night jobs, or added
// by hand), and the manager's list of postpone reasons.

type Section = 'jobs' | 'reasons'

export function ToSchedule() {
  const [section, setSection] = useState<Section>('jobs')
  const lists = [
    useDriveList('pendingJobs'),
    useDriveList('postponeReasons'),
    useDriveList('shifts'),
    useDriveList('shiftDefinitions'),
    useDriveList('workers'),
    useDriveList('roles'),
  ]
  const loading = lists.some((l) => l.query.isPending)
  const failed = lists.find((l) => l.query.isError)

  return (
    <section className="space-y-4 px-4 pt-6">
      <h1 className="text-2xl font-bold">לשיבוץ</h1>
      <div role="tablist" aria-label="מה להציג" className="grid grid-cols-2 rounded-xl bg-slate-900 p-1">
        {(
          [
            ['jobs', 'עבודות שממתינות'],
            ['reasons', 'סיבות דחייה'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            onClick={() => setSection(id)}
            className={`min-h-11 rounded-lg text-sm font-medium ${section === id ? 'bg-slate-700 text-slate-50' : 'text-slate-400'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {failed ? (
        <DriveError error={failed.query.error} action="load" onRetry={() => lists.forEach((l) => l.query.isError && l.query.refetch())} />
      ) : loading ? (
        <p className="flex items-center gap-2 text-slate-400">
          <Loader2 className="animate-spin" size={18} aria-hidden />
          טוען מגוגל דרייב...
        </p>
      ) : (
        <div role="tabpanel">{section === 'jobs' ? <JobsSection /> : <ReasonsSection />}</div>
      )}
    </section>
  )
}

const blankJob = (): PendingJob => ({ id: newId(), location: '', jobDescription: '', reasonIds: [], createdAt: new Date().toISOString() })

function JobsSection() {
  const jobs = useDriveList('pendingJobs')
  const reasons = useDriveList('postponeReasons')
  const shifts = useDriveList('shifts')
  const waiting = jobs.items.filter((j) => isWaiting(j, shifts.items))
  const [editing, setEditing] = useState<PendingJob | null>(null)
  const [scheduling, setScheduling] = useState<ShiftRecord | null>(null)

  return (
    <>
      {waiting.length === 0 ? (
        <EmptyState
          text="אין עבודות שממתינות. עבודת לילה שנסגרה כ'בוצע חלקית' או 'נדחה' תופיע כאן, ואפשר גם להוסיף עבודה ביד."
          addLabel="הוספת עבודה"
          onAdd={() => setEditing(blankJob())}
        />
      ) : (
        <>
          <ul className="space-y-2">
            {waiting.map((j) => {
              const outcome = OUTCOMES.find((o) => o.id === j.outcome)
              const why = [tagNames(j.reasonIds, reasons.items).join(', '), j.note].filter(Boolean).join(' · ')
              return (
                <li key={j.id} className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
                  <button type="button" onClick={() => setEditing(j)} className="relative w-full space-y-1 p-4 pe-9 text-start">
                    <EditMark />
                    <span className="flex flex-wrap items-center gap-2 text-xs">
                      {j.followUp ? (
                        <span className="rounded-full border border-sky-500 bg-sky-500/15 px-2 py-0.5 font-semibold text-sky-200">משימת המשך</span>
                      ) : (
                        outcome && <span className={`rounded-full border px-2 py-0.5 font-semibold ${outcome.tone}`}>{outcome.label}</span>
                      )}
                      {j.createdAt && <span className="text-slate-400">מ-{showDate(todayIso(new Date(j.createdAt)))}</span>}
                    </span>
                    {j.location && <span className="block font-semibold">{j.location}</span>}
                    {j.jobDescription && <span className="block text-sm text-slate-300">{j.jobDescription}</span>}
                    {why && <span className="block text-sm text-slate-400">{why}</span>}
                  </button>
                  <TaskHistory job={j} />
                  <button
                    type="button"
                    onClick={() => setScheduling(blankShift(todayIso(), j))}
                    className="flex min-h-12 w-full items-center gap-2 border-t border-slate-800 px-4 text-sm font-semibold text-sky-400"
                  >
                    <CalendarPlus size={18} aria-hidden />
                    שיבוץ למשמרת
                  </button>
                </li>
              )
            })}
          </ul>
          <AddButton label="הוספת עבודה" onClick={() => setEditing(blankJob())} />
        </>
      )}

      <Sheet open={editing !== null} title={editing && jobs.items.some((j) => j.id === editing.id) ? 'עריכת עבודה' : 'עבודה חדשה'} onClose={() => setEditing(null)} locked={jobs.saving}>
        {editing && <JobForm job={editing} onDone={() => setEditing(null)} />}
      </Sheet>
      <ShiftSheet editing={scheduling} onClose={() => setScheduling(null)} />
    </>
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
        {steps.length === 1 ? `מקושרת למשימה מ-${showDate(first.date)}` : `מקושרת ל-${steps.length} משימות קודמות, מ-${showDate(first.date)}`}
      </summary>
      <ol className="space-y-2 border-s border-slate-700 ps-3 pt-1">
        {steps.map(({ shift: s }) => {
          const outcome = OUTCOMES.find((o) => o.id === s.closure?.outcome)
          const why = s.closure ? [tagNames(s.closure.reasonIds, reasons.items).join(', '), s.closure.note].filter(Boolean).join(' · ') : ''
          return (
            <li key={s.id} className="space-y-0.5">
              <span className="block text-xs text-slate-400">
                יום {dayName(s.date)} {showDate(s.date)}
                {s.location && ` · ${s.location}`}
              </span>
              {s.jobDescription && <span className="block text-slate-200">{s.jobDescription}</span>}
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

function JobForm({ job, onDone }: { job: PendingJob; onDone: () => void }) {
  const jobs = useDriveList('pendingJobs')
  const [draft, setDraft] = useState(job)
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

  const save = () => {
    const clean = { ...draft, location: draft.location.trim(), jobDescription: draft.jobDescription.trim(), note: draft.note?.trim() || undefined }
    const err = clean.location || clean.jobDescription ? null : 'צריך למלא מיקום או מהות עבודה'
    setError(err)
    if (!err) write(upsert(jobs.items, clean))
  }

  return (
    <>
      <Field label="מיקום">
        <input autoFocus value={draft.location} onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))} className={inputClass} />
      </Field>
      <DictationField label="מהות העבודה" value={draft.jobDescription} onChange={(v) => setDraft((d) => ({ ...d, jobDescription: v }))} />
      <DictationField label="הערות" value={draft.note ?? ''} onChange={(v) => setDraft((d) => ({ ...d, note: v }))} />
      <SheetActions
        onSave={save}
        onCancel={onDone}
        onDelete={exists ? () => write(jobs.items.filter((j) => j.id !== job.id)) : undefined}
        deleteWarning="למחוק את העבודה מהרשימה? היא לא תחכה יותר לשיבוץ."
        busy={busy}
        error={error}
        saveError={saveError}
      />
    </>
  )
}

function ReasonsSection() {
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
          text="סיבות דחייה הן הרשימה שממנה תבחר כשעבודת לילה נדחית."
          addLabel="הוספת סיבה"
          onAdd={() => setEditing({ id: newId(), name: '' })}
          starterLabel={`להתחיל עם: ${STARTER_POSTPONE_REASONS.join(', ')}`}
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
          <AddButton label="הוספת סיבה" onClick={() => setEditing({ id: newId(), name: '' })} />
        </>
      )}
      <Sheet open={editing !== null} title={editing && reasons.items.some((r) => r.id === editing.id) ? 'עריכת סיבה' : 'סיבה חדשה'} onClose={() => setEditing(null)} locked={reasons.saving}>
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
      <Field label="הסיבה">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </Field>
      <SheetActions
        onSave={save}
        onCancel={onDone}
        // Closed jobs keep the id; a deleted reason just stops showing on them.
        onDelete={exists ? () => write(reasons.items.filter((r) => r.id !== reason.id)) : undefined}
        deleteWarning="למחוק את הסיבה מהרשימה? בעבודות שכבר נסגרו עם הסיבה הזו היא לא תוצג יותר."
        busy={busy}
        error={error}
        saveError={saveError}
      />
    </>
  )
}
