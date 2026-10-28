import { useState } from 'react'
import { X } from 'lucide-react'
import { DateField } from '../../components/DateField'
import { DictationField } from '../../components/DictationField'
import { Field, inputClass, Sheet, SheetActions } from '../../components/Sheet'
import { fullName, generalRoleId, isGeneralRole, staffingFor, upsert, workerHasRole } from '../../lib/catalog'
import { useDriveList } from '../../lib/data/useDriveList'
import { isNightShift, pendingAfterShiftSave, shiftRecordError, weekShiftCount } from '../../lib/shifts'
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
    const clean: ShiftRecord = { ...draft, location: draft.location.trim(), jobDescription: draft.jobDescription.trim() }
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
  const available = workers.items.filter((w) => !inCrew.has(w.id))
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
      <DictationField label="מהות העבודה" value={draft.jobDescription} onChange={(v) => set('jobDescription', v)} />
      <StaffingField value={draft.staffing} onChange={(staffing) => set('staffing', staffing)} />

      <div className="space-y-2">
        <span className="text-sm text-slate-300">
          עובדים במשמרת ({draft.crew.length} מתוך {draft.staffing.length})
        </span>
        {draft.crew.map((c, i) => {
          const w = workers.items.find((x) => x.id === c.workerId)
          const options = roleOptions(w)
          return (
            <div key={c.workerId} className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 p-2">
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
                aria-label="הוצאה מהמשמרת"
                onClick={() => set('crew', draft.crew.filter((_, j) => j !== i))}
                className="flex size-11 items-center justify-center rounded-lg text-slate-400"
              >
                <X size={18} aria-hidden />
              </button>
            </div>
          )
        })}
        {available.length > 0 ? (
          <select
            aria-label="הוספת עובד למשמרת"
            value=""
            onChange={(e) => addWorker(e.target.value)}
            className={`${inputClass} text-slate-300`}
          >
            <option value="">+ הוספת עובד</option>
            {available.map((w) => (
              <option key={w.id} value={w.id}>
                {fullName(w)} · {plural(weekShiftCount(w.id, draft.date, shifts.items, draft.id))}
              </option>
            ))}
          </select>
        ) : (
          workers.items.length === 0 && <p className="text-sm text-amber-300">עוד אין עובדים. אפשר להוסיף אותם בלשונית "עובדים".</p>
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
