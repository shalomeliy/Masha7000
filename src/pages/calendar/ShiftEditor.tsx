import { useState } from 'react'
import { ArrowLeftRight, Sparkles, X } from 'lucide-react'
import { DateField } from '../../components/DateField'
import { DictationField } from '../../components/DictationField'
import { Field, inputClass, Sheet, SheetActions } from '../../components/Sheet'
import { Suggestions } from '../../components/Suggestions'
import { fullName, generalRoleId, isGeneralRole, staffingFor, upsert, workerHasRole } from '../../lib/catalog'
import { crewSwaps } from '../../lib/archive'
import { useDriveList } from '../../lib/data/useDriveList'
import { autoAssign, candidateOrder, fitsSlot, loadWarning, type PlanContext, type WorkerLoad } from '../../lib/planner'
import { isNightShift, pendingAfterShiftSave, shiftRecordError } from '../../lib/shifts'
import type { ShiftRecord, Worker } from '../../types/models'
import { WorkerDial } from '../workers/common'
import { StaffingField } from './StaffingField'

// Create or edit one shift. A new shift that came from "לשיבוץ" removes that job when saved.

export function ShiftSheet({ editing, onClose }: { editing: ShiftRecord | null; onClose: () => void }) {
  const shifts = useDriveList('shifts')
  const pending = useDriveList('pendingJobs')
  const exists = editing && shifts.items.some((s) => s.id === editing.id)
  return (
    <Sheet
      open={editing !== null}
      title={exists ? 'עריכת משמרת' : editing?.urgent ? 'משמרת דחופה מעכשיו' : 'משמרת חדשה'}
      onClose={onClose}
      locked={shifts.saving || pending.saving}
    >
      {editing && <ShiftForm shift={editing} onDone={onClose} />}
    </Sheet>
  )
}

const plural = (n: number) => (n === 0 ? 'אין לו משמרות השבוע' : n === 1 ? 'כבר משמרת אחת השבוע' : `כבר ${n} משמרות השבוע`)

// "דני כהן · כבר משמרת אחת השבוע · כבר שובץ ל-2 לילות השבוע" for the worker pickers.
const pickLabel = (w: Worker, load: WorkerLoad) => [fullName(w), plural(load.week), loadWarning(load)].filter(Boolean).join(' · ')

function ShiftForm({ shift, onDone }: { shift: ShiftRecord; onDone: () => void }) {
  const shifts = useDriveList('shifts')
  const pending = useDriveList('pendingJobs')
  const defs = useDriveList('shiftDefinitions')
  const workers = useDriveList('workers')
  const roles = useDriveList('roles')
  const certs = useDriveList('certifications')
  const general = generalRoleId(roles.items)
  // Crew saved before "כללי" existed may have no role; they are "כללי" now.
  const [draft, setDraft] = useState(() => ({
    ...shift,
    crew: shift.crew.map((c) => (c.roleId ? c : { ...c, roleId: general })),
    staffing: staffingFor(shift.staffing, roles.items, certs.items.map((c) => c.id)),
  }))
  const [datesValid, setDatesValid] = useState({ date: true, end: true })
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [planNote, setPlanNote] = useState<string[] | null>(null)
  const [swapping, setSwapping] = useState<string | null>(null)
  const exists = shifts.items.some((s) => s.id === shift.id)

  const set = <K extends keyof ShiftRecord>(key: K, value: ShiftRecord[K]) => setDraft((d) => ({ ...d, [key]: value }))

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setSaveError(null)
    try {
      await work()
      onDone()
    } catch (e) {
      setSaveError(e)
    } finally {
      setBusy(false)
    }
  }

  const save = () => {
    // A worker replaced in a saved shift is kept in its history, for the archive.
    const saved = shifts.items.find((s) => s.id === shift.id)
    const swaps = saved ? crewSwaps(saved.crew, draft.crew, new Date().toISOString()) : []
    const clean: ShiftRecord = {
      ...draft,
      location: draft.location.trim(),
      jobDescription: draft.jobDescription.trim(),
      ...(swaps.length ? { swaps: [...(draft.swaps ?? []), ...swaps] } : {}),
    }
    const err =
      !datesValid.date || !datesValid.end
        ? 'יש תאריך לא תקין'
        : clean.closure && !isNightShift(clean, defs.items)
          ? 'העבודה הזו כבר נסגרה, ולכן היא נשארת משמרת לילה. כדי לשנות, קודם פתח מחדש את הסגירה.'
          : shiftRecordError(clean, workers.items, roles.items.map((r) => r.id), general)
    setError(err)
    if (err) return
    run(async () => {
      // Shift first: if the second write fails, saving again re-applies it (both steps are idempotent).
      await shifts.save(upsert(shifts.items, clean))
      const nextPending = pendingAfterShiftSave(pending.items, clean)
      if (nextPending !== pending.items) await pending.save(nextPending)
    })
  }

  // A job scheduled into this shift is kept in the waiting file, so it shows in "לשיבוץ" again.
  const remove = () => run(() => shifts.save(shifts.items.filter((s) => s.id !== shift.id)))

  const inCrew = new Set(draft.crew.map((c) => c.workerId))
  const planCtx: PlanContext = { workers: workers.items, records: shifts.items, defs: defs.items, generalId: general }
  // Fairest first: the same order the automatic crew uses.
  const ranked = candidateOrder(draft, planCtx)
  const available = ranked.filter((c) => !inCrew.has(c.worker.id))
  const loadOf = (id: string) => ranked.find((c) => c.worker.id === id)?.load

  // The manager only says who is needed; "שבץ" picks the workers. Manual changes come after.
  const plan = () => {
    const { crew, unfilled, why } = autoAssign(draft, draft.staffing, planCtx)
    set('crew', crew)
    setSwapping(null)
    const lines = unfilled.map((s, i) => {
      const role = roles.items.find((r) => r.id === s.roleId)?.name ?? ''
      const cert = certs.items.find((c) => c.id === s.certificationId)?.name
      return `${cert ? `${role} (${cert})` : role}: ${why[i]}`
    })
    setPlanNote(lines.length ? lines : null)
  }

  // Swap keeps the place's role, so only workers holding it are offered.
  const swap = (i: number, id: string) => {
    set('crew', draft.crew.map((x, j) => (j === i ? { ...x, workerId: id } : x)))
    setSwapping(null)
  }
  const roleOptions = (w: Worker | undefined) => (w ? roles.items.filter((r) => workerHasRole(w, r.id, general)) : [])

  // A new crew member gets their own role; "כללי" only when they have no other.
  const addWorker = (id: string) => {
    const w = workers.items.find((x) => x.id === id)
    if (!w) return
    const options = roleOptions(w)
    set('crew', [...draft.crew, { workerId: id, roleId: (options.find((r) => !isGeneralRole(r)) ?? options[0])?.id ?? general }])
  }

  return (
    <>
      {draft.urgent ? (
        <div className="grid grid-cols-2 gap-3">
          <DateField label="מתחילה בתאריך" value={draft.date} required onChange={(date, ok) => (set('date', date), setDatesValid((v) => ({ ...v, date: ok })))} />
          <Field label="בשעה">
            <input type="time" value={draft.startTime ?? ''} onChange={(e) => set('startTime', e.target.value)} className={inputClass} />
          </Field>
          <DateField
            label="נגמרת בתאריך"
            value={draft.endDate ?? ''}
            min={draft.date}
            required
            onChange={(endDate, ok) => (set('endDate', endDate), setDatesValid((v) => ({ ...v, end: ok })))}
          />
          <Field label="בשעה">
            <input type="time" value={draft.endTime ?? ''} onChange={(e) => set('endTime', e.target.value)} className={inputClass} />
          </Field>
        </div>
      ) : (
        <>
          <DateField label="תאריך" value={draft.date} required onChange={(date, ok) => (set('date', date), setDatesValid((v) => ({ ...v, date: ok })))} />
          <div className="space-y-1">
            <span className="text-sm text-slate-300">סוג משמרת</span>
            {defs.items.length ? (
              <div className="flex flex-wrap gap-2">
                {defs.items.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    aria-pressed={draft.shiftDefinitionId === d.id}
                    onClick={() => set('shiftDefinitionId', d.id)}
                    className={`min-h-11 rounded-full border px-4 text-sm ${
                      draft.shiftDefinitionId === d.id ? 'border-sky-500 bg-sky-500/15 text-sky-300' : 'border-slate-700 text-slate-300'
                    }`}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-amber-300">עוד אין סוגי משמרות. אפשר להוסיף אותם בלשונית "עובדים", "משמרות".</p>
            )}
          </div>
        </>
      )}

      <Field label="מיקום">
        <input value={draft.location} onChange={(e) => set('location', e.target.value)} className={inputClass} />
      </Field>
      <Suggestions list="places" value={draft.location} onPick={(v) => set('location', v)} />
      <DictationField label="מהות העבודה" value={draft.jobDescription} onChange={(v) => set('jobDescription', v)} />
      <Suggestions list="jobTypes" value={draft.jobDescription} onPick={(v) => set('jobDescription', v)} />
      <StaffingField value={draft.staffing} onChange={(staffing) => set('staffing', staffing)} />

      <div className="space-y-2">
        <span className="text-sm text-slate-300">
          עובדים במשמרת ({draft.crew.length} מתוך {draft.staffing.length})
        </span>
        {draft.crew.map((c, i) => {
          const w = workers.items.find((x) => x.id === c.workerId)
          const options = roleOptions(w)
          const load = loadOf(c.workerId)
          const warning = load && loadWarning(load)
          const swapOptions = available.filter((x) => fitsSlot(x.worker, { roleId: c.roleId }, general))
          return (
            // A constraint keeps this worker out on the shift's day: outlined in orange, swap is right there.
            <div key={c.workerId} className={`rounded-xl bg-slate-950 p-2 ${load?.blocked ? 'border-2 border-orange-500' : 'border border-slate-800'}`}>
              <div className="flex items-center gap-2">
              <WorkerDial worker={w} className="min-h-11 min-w-0 flex-1 ps-1" />
              {options.length ? (
                <select
                  aria-label={`התפקיד של ${w ? fullName(w) : ''}`}
                  value={c.roleId}
                  onChange={(e) => set('crew', draft.crew.map((x, j) => (j === i ? { ...x, roleId: e.target.value } : x)))}
                  className="min-h-11 rounded-lg border border-slate-700 bg-slate-900 px-2 text-sm"
                >
                  {!options.some((r) => r.id === c.roleId) && <option value="">בחר תפקיד</option>}
                  {options.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-amber-300">אין לו תפקידים</span>
              )}
              <button
                type="button"
                aria-label={`החלפת ${w ? fullName(w) : 'העובד'} בעובד אחר`}
                aria-expanded={swapping === c.workerId}
                onClick={() => setSwapping((s) => (s === c.workerId ? null : c.workerId))}
                className="flex size-11 items-center justify-center rounded-lg text-slate-400"
              >
                <ArrowLeftRight size={18} aria-hidden />
              </button>
              <button
                type="button"
                aria-label="הוצאה מהמשמרת"
                onClick={() => set('crew', draft.crew.filter((_, j) => j !== i))}
                className="flex size-11 items-center justify-center rounded-lg text-slate-400"
              >
                <X size={18} aria-hidden />
              </button>
              </div>
              {warning && (
                <p className={`ps-1 text-xs ${load.blocked ? 'text-orange-300' : 'text-amber-300'}`}>
                  {warning}
                  {load.blocked && ' · אפשר להחליף בכפתור החצים'}
                </p>
              )}
              {swapping === c.workerId &&
                (swapOptions.length ? (
                  <select aria-label={`במקום ${w ? fullName(w) : 'העובד'}`} value="" onChange={(e) => swap(i, e.target.value)} className={`${inputClass} mt-2 text-slate-300`}>
                    <option value="">במקומו...</option>
                    {swapOptions.map(({ worker: x, load: l }) => (
                      <option key={x.id} value={x.id}>
                        {pickLabel(x, l)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="mt-2 ps-1 text-xs text-slate-400">אין עובד פנוי אחר עם התפקיד הזה</p>
                ))}
            </div>
          )
        })}
        {workers.items.length > 0 && draft.crew.length === 0 && <p className="text-sm text-slate-400">לחץ "שבץ" והמערכת תבחר את העובדים לבד.</p>}
        {draft.crew.length > 0 && available.length > 0 ? (
          <select
            aria-label="הוספת עובד למשמרת"
            value=""
            onChange={(e) => addWorker(e.target.value)}
            className={`${inputClass} text-slate-300`}
          >
            <option value="">+ הוספת עובד</option>
            {available.map(({ worker: w, load }) => (
              <option key={w.id} value={w.id}>
                {pickLabel(w, load)}
              </option>
            ))}
          </select>
        ) : (
          workers.items.length === 0 && <p className="text-sm text-amber-300">עוד אין עובדים. אפשר להוסיף אותם בלשונית "עובדים".</p>
        )}
        {workers.items.length > 0 && (
          <button
            type="button"
            onClick={plan}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-sky-500 bg-sky-500/15 text-sm font-medium text-sky-300"
          >
            <Sparkles size={18} aria-hidden />
            {draft.crew.length ? 'שבץ את המקומות החסרים' : 'שבץ'}
          </button>
        )}
        {planNote && (
          <div role="status" className="space-y-1 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
            <p className="font-medium">לא נמצא עובד לכל המקומות:</p>
            {planNote.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        )}
      </div>

      <SheetActions
        onSave={save}
        onCancel={onDone}
        onDelete={exists ? remove : undefined}
        deleteWarning={`לבטל את המשמרת? היא תימחק מהיומן.${shift.fromJobId ? ' העבודה תחזור ללשונית "לשיבוץ".' : ''}`}
        deleteLabel="ביטול משמרת"
        confirmLabel="כן, לבטל"
        busy={busy}
        error={error}
        saveError={saveError}
      />
    </>
  )
}
