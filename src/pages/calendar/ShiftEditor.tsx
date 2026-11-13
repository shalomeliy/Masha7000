import { tx } from '../../i18n'
import { useState } from 'react'
import { ArrowLeftRight, Lock, Sparkles, X } from 'lucide-react'
import { DateField } from '../../components/DateField'
import { DictationField } from '../../components/DictationField'
import { Field, inputClass, Sheet, SheetActions } from '../../components/Sheet'
import { Suggestions } from '../../components/Suggestions'
import { defaultShiftDef, fullName, placeText, slotCerts, staffingFor, upsert } from '../../lib/catalog'
import { crewSwaps } from '../../lib/archive'
import { useDriveList } from '../../lib/data/useDriveList'
import { crewCover, type GapContext } from '../../lib/gaps'
import { pinnedOf } from '../../lib/pinnedDates'
import { autoAssign, busyCrew, busyText, busyWith, candidateOrder, fitsSlot, loadWarning, pullFrom, type PlanContext, type WorkerLoad } from '../../lib/planner'
import { dayName, isNightShift, pendingAfterShiftSave, showDate, shiftRecordError } from '../../lib/shifts'
import type { ShiftRecord, Worker } from '../../types/models'
import { WorkerDial } from '../workers/common'
import { PinnedField } from './PinnedField'
import { AutoDate } from './AutoDate'
import type { DateOption } from '../../lib/pinnedDates'
import { PullConfirm } from './PullConfirm'
import { ShiftDefField } from './ShiftDefField'
import { StaffingField } from './StaffingField'
import { VehiclePick } from './VehiclePick'
import { WorkKindField } from './WorkKindField'
import { toggleKind } from '../../lib/workKinds'
import { asTaskList } from '../../lib/taskList'

// Create or edit one shift. A new shift that came from "לשיבוץ" removes that job when saved.

export function ShiftSheet({ editing, onClose }: { editing: ShiftRecord | null; onClose: () => void }) {
  const shifts = useDriveList('shifts')
  const pending = useDriveList('pendingJobs')
  const exists = editing && shifts.items.some((s) => s.id === editing.id)
  return (
    <Sheet
      open={editing !== null}
      title={exists ? tx('עריכת עבודה') : editing?.urgent ? tx('עבודה דחופה מעכשיו') : tx('עבודה חדשה')}
      onClose={onClose}
      locked={shifts.saving || pending.saving}
    >
      {editing && <ShiftForm shift={editing} onDone={onClose} />}
    </Sheet>
  )
}

const plural = (n: number) => (n === 0 ? tx('אין לו עבודות השבוע') : n === 1 ? tx('כבר עבודה אחת השבוע') : tx('כבר {n} עבודות השבוע', { n }))

// "דני כהן · כבר עבודה אחת השבוע · כבר שובץ ל-2 לילות השבוע" for the worker pickers.
const pickLabel = (w: Worker, load: WorkerLoad) => [fullName(w), plural(load.week), loadWarning(load)].filter(Boolean).join(' · ')

function ShiftForm({ shift, onDone }: { shift: ShiftRecord; onDone: () => void }) {
  const shifts = useDriveList('shifts')
  const pending = useDriveList('pendingJobs')
  const defs = useDriveList('shiftDefinitions')
  const workers = useDriveList('workers')
  const certs = useDriveList('certifications')
  const [draft, setDraft] = useState(() => ({
    ...shift,
    // A new planned shift starts as "יום": the manager kept saving without noticing the type.
    shiftDefinitionId: shift.shiftDefinitionId ?? (shift.urgent ? undefined : defaultShiftDef(defs.items)?.id),
    // Only the worker: what crews saved while roles existed held besides is left out.
    crew: shift.crew.map((c) => ({ workerId: c.workerId })),
    staffing: staffingFor(shift.staffing, certs.items.map((c) => c.id)),
  }))
  const [datesValid, setDatesValid] = useState({ date: true, end: true })
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [planNote, setPlanNote] = useState<string[] | null>(null)
  const [swapping, setSwapping] = useState<string | null>(null)
  // Workers the manager chose to take out of another job at the same time; they leave it on save.
  const [pulled, setPulled] = useState<string[]>([])
  // Who takes a pulled worker's place in the job they leave; none leaves it empty.
  const [fillIns, setFillIns] = useState<Record<string, string>>({})
  // Set by the first "שמירה" while workers are busy elsewhere: the second one moves them (busyError).
  const [moveAsked, setMoveAsked] = useState<string[]>([])
  const [asking, setAsking] = useState<{ worker: Worker; other: ShiftRecord; apply: () => void } | null>(null)
  const exists = shifts.items.some((s) => s.id === shift.id)
  // "בחירה אוטומטית" (new planned jobs only): the day is picked from the nearest days that can be fully staffed.
  const canAuto = !exists && !shift.urgent
  const [autoDate, setAutoDate] = useState(false)
  const [autoPicked, setAutoPicked] = useState<string | null>(null)
  const pickDate = (o: DateOption) => {
    setDraft((d) => ({ ...d, date: o.date, crew: o.shift.crew }))
    setDatesValid((v) => ({ ...v, date: true }))
    setAutoPicked(o.date)
    setPlanNote(null)
    setError(null)
  }

  const thenJob = !draft.urgent && !!defs.items.find((d) => d.id === draft.shiftDefinitionId)?.thenJob
  const nextJob = draft.nextJob ?? { location: '', jobDescription: '' }

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

  // A worker cannot be in two shifts that run at the same time (a night job runs into the next afternoon).
  const pulledIn = (r: ShiftRecord) => pulled.filter((id) => r.crew.some((c) => c.workerId === id))
  // The user's rule (2026-11-07): a busy worker is a warning, not a wall. The first "שמירה" lists who is
  // busy where, each with "להשאיר אותו שם" (he leaves this job instead); pressing "שמירה" again moves
  // the rest here and leaves their place in the other job empty. Only a closed job keeps them (it is
  // history), so then they must be replaced.
  const busyIn = (r: ShiftRecord) => busyCrew(r, workers.items, pullFrom(r, pulledIn(r), shifts.items, defs.items, fillIns), defs.items)
  const busyError = (r: ShiftRecord) => {
    const busy = busyIn(r)
    if (!busy.length) return null
    if (busy.some((b) => b.other.closure)) return tx('{v}. החלף {v2} לפני השמירה.', { v: busyText(busy), v2: busy.length > 1 ? tx('אותם') : tx('אותו') })
    // Already listed: whoever is still in the crew is moved. Someone newly busy is asked about first.
    if (busy.every((b) => moveAsked.includes(b.worker.id))) return null
    setMoveAsked(busy.map((b) => b.worker.id))
    return tx('בחר לכל עובד מה לעשות, ואז לחץ שוב על "שמירה". עובד שעובר לכאן ישאיר מקום ריק בעבודה השנייה.')
  }
  // The busy workers listed after the first "שמירה" who are still in the crew.
  const listedBusy = moveAsked.length ? busyIn(draft).filter((b) => moveAsked.includes(b.worker.id) && !b.other.closure) : []
  const keepThere = (id: string) => {
    setDraft((d) => ({ ...d, crew: d.crew.filter((c) => c.workerId !== id) }))
    setError(null)
  }

  const save = () => {
    // A worker replaced in a saved shift is kept in its history, for the archive.
    const saved = shifts.items.find((s) => s.id === shift.id)
    const swaps = saved ? crewSwaps(saved.crew, draft.crew, new Date().toISOString()) : []
    const next = { location: nextJob.location.trim(), jobDescription: asTaskList(nextJob.jobDescription) }
    const clean: ShiftRecord = {
      ...draft,
      location: draft.location.trim(),
      jobDescription: asTaskList(draft.jobDescription),
      // Only "לינה" carries the job after the night; switching type away drops it.
      nextJob: thenJob && (next.location || next.jobDescription) ? next : undefined,
      ...(swaps.length ? { swaps: [...(draft.swaps ?? []), ...swaps] } : {}),
      // Only workers still in the crew stay pinned.
      pinnedIds: pinnedOf(draft).length ? pinnedOf(draft) : undefined,
    }
    const err =
      autoDate && !autoPicked
        ? tx('בחר אחד מהתאריכים שהמערכת הציעה, או בטל את הבחירה האוטומטית')
        : !datesValid.date || !datesValid.end
        ? tx('יש תאריך לא תקין')
        : clean.closure && !isNightShift(clean, defs.items)
          ? tx('העבודה הזו כבר נסגרה, ולכן היא נשארת עבודת לילה. כדי לשנות, קודם פתח מחדש את הסגירה.')
          : shiftRecordError(clean, workers.items) ?? busyError(clean)
    setError(err)
    if (err) return
    // Workers the manager chose to move by pressing "שמירה" again, with the ones pulled one by one.
    const moving = [...new Set([...pulledIn(clean), ...busyIn(clean).map((b) => b.worker.id)])]
    run(async () => {
      // Shift first: if the second write fails, saving again re-applies it (both steps are idempotent).
      // A worker pulled from another job leaves it in the same write.
      await shifts.save(pullFrom(clean, moving, upsert(shifts.items, clean), defs.items, fillIns))
      const nextPending = pendingAfterShiftSave(pending.items, clean)
      if (nextPending !== pending.items) await pending.save(nextPending)
    })
  }

  // A job scheduled into this shift is kept in the waiting file, so it shows in "לשיבוץ" again.
  const remove = () => run(() => shifts.save(shifts.items.filter((s) => s.id !== shift.id)))

  const inCrew = new Set(draft.crew.map((c) => c.workerId))
  const planCtx: PlanContext = { workers: workers.items, records: shifts.items, defs: defs.items }
  const gapCtx: GapContext = { ...planCtx, certifications: certs.items }
  const pinned = pinnedOf(draft)
  // Fairest first: the same order the automatic crew uses.
  const ranked = candidateOrder(draft, planCtx)
  // Workers already in another shift at the same time are not offered at all.
  const available = ranked.filter((c) => !inCrew.has(c.worker.id) && !c.load.busy)
  // Fitting workers in another job at the same time are offered apart; picking one asks first.
  const others = ranked.filter((c) => !inCrew.has(c.worker.id) && c.load.busy && !c.load.blocked)
  const choose = (id: string, apply: (id: string) => void) => {
    const other = busyWith(id, draft, shifts.items, defs.items)
    const worker = workers.items.find((w) => w.id === id)
    if (!other || !worker) return apply(id)
    setAsking({
      worker,
      other,
      apply: () => {
        apply(id)
        setPulled((p) => [...p, id])
      },
    })
  }
  const otherText = (id: string) => {
    const o = busyWith(id, draft, shifts.items, defs.items)
    return o ? tx('ביום {weekday} {v2}{v3}', { weekday: dayName(o.date), v2: showDate(o.date), v3: o.location ? ` (${o.location})` : '' }) : ''
  }
  const cover = crewCover(draft, draft.staffing, workers.items)
  const covered = new Set([...cover.values()].flat()).size
  const loadOf = (id: string) => ranked.find((c) => c.worker.id === id)?.load

  // The manager only says who is needed; "שבץ" picks the workers. Manual changes come after.
  const plan = () => {
    const { crew, unfilled, why } = autoAssign(draft, draft.staffing, planCtx)
    set('crew', crew)
    setSwapping(null)
    const lines = unfilled.map((s, i) => `${placeText(s, certs.items)}: ${why[i]}`)
    setPlanNote(lines.length ? lines : null)
  }

  // Swap keeps the place, so only workers holding its certifications are offered.
  const swap = (i: number, id: string) => {
    set('crew', draft.crew.map((x, j) => (j === i ? { ...x, workerId: id } : x)))
    setSwapping(null)
  }
  const addWorker = (id: string) => {
    if (workers.items.some((x) => x.id === id)) set('crew', [...draft.crew, { workerId: id }])
  }

  return (
    <>
      {draft.urgent ? (
        <div className="grid grid-cols-2 gap-3">
          <DateField label={tx('מתחילה בתאריך')} value={draft.date} required onChange={(date, ok) => (set('date', date), setDatesValid((v) => ({ ...v, date: ok })))} />
          <Field label={tx('בשעה')}>
            <input type="time" value={draft.startTime ?? ''} onChange={(e) => set('startTime', e.target.value)} className={inputClass} />
          </Field>
          <DateField
            label={tx('נגמרת בתאריך')}
            value={draft.endDate ?? ''}
            min={draft.date}
            required
            onChange={(endDate, ok) => (set('endDate', endDate), setDatesValid((v) => ({ ...v, end: ok })))}
          />
          <Field label={tx('בשעה')}>
            <input type="time" value={draft.endTime ?? ''} onChange={(e) => set('endTime', e.target.value)} className={inputClass} />
          </Field>
        </div>
      ) : (
        <>
          <DateField label={tx('תאריך')} value={draft.date} required disabled={autoDate} onChange={(date, ok) => (set('date', date), setDatesValid((v) => ({ ...v, date: ok })))} />
          {canAuto && (
            <label className="flex min-h-11 items-center gap-3 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={autoDate}
                onChange={(e) => (setAutoDate(e.target.checked), setAutoPicked(null), setError(null))}
                className="size-5 accent-sky-500"
              />
              <span>
                {tx('בחירה אוטומטית')}
                <span className="block text-xs text-slate-400">{tx('המערכת תציע את התאריכים הקרובים שיש בהם מספיק עובדים, אחרי שתמלא כמה אנשים צריך')}</span>
              </span>
            </label>
          )}
          <ShiftDefField value={draft.shiftDefinitionId} onChange={(id) => set('shiftDefinitionId', id)} />
        </>
      )}

      <Field label={tx('מיקום')}>
        <input value={draft.location} onChange={(e) => set('location', e.target.value)} className={inputClass} />
      </Field>
      <Suggestions list="places" value={draft.location} onPick={(v) => set('location', v)} />
      <DictationField label={tx('מהות העבודה')} value={draft.jobDescription} tasks onChange={(v) => set('jobDescription', v)} />
      <Suggestions list="jobTypes" value={draft.jobDescription} onPick={(v) => set('jobDescription', v)} />
      {thenJob && (
        <div className="space-y-2 rounded-2xl border border-violet-500/50 bg-violet-500/10 p-3">
          <p className="text-sm font-medium text-violet-200">{tx('אחרי הלילה, לפני החזרה לבסיס')}</p>
          <Field label={tx('מיקום העבודה הנוספת')}>
            <input value={nextJob.location} onChange={(e) => set('nextJob', { ...nextJob, location: e.target.value })} className={inputClass} />
          </Field>
          <Suggestions list="places" value={nextJob.location} onPick={(v) => set('nextJob', { ...nextJob, location: v })} />
          <DictationField label={tx('מהות העבודה הנוספת')} value={nextJob.jobDescription} tasks onChange={(v) => set('nextJob', { ...nextJob, jobDescription: v })} />
        </div>
      )}
      <WorkKindField value={draft.workKindIds} onToggle={(kind) => setDraft((d) => ({ ...d, ...toggleKind(d, kind) }))} />
      <VehiclePick value={draft} onChange={(v) => setDraft((d) => ({ ...d, ...v }))} />
      <StaffingField value={draft.staffing} onChange={(staffing) => set('staffing', staffing)} />
      {workers.items.length > 0 && <PinnedField draft={draft} ctx={gapCtx} noSearch={autoDate} onChange={(next) => (setDraft((d) => ({ ...d, ...next })), setPlanNote(null), setError(null))} />}
      {autoDate && (
        <div data-auto-date>
          <AutoDate draft={draft} ctx={gapCtx} picked={autoPicked} onPick={pickDate} />
        </div>
      )}

      <div className="space-y-2">
        <span className="text-sm text-slate-300">
          {covered > draft.crew.length
            ? tx('עובדים בעבודה: {length}, ממלאים {covered} מתוך {length2} מקומות', { length: draft.crew.length, covered, length2: draft.staffing.length })
            : tx('עובדים בעבודה ({length} מתוך {length2})', { length: draft.crew.length, length2: draft.staffing.length })}
        </span>
        {draft.crew.map((c, i) => {
          const w = workers.items.find((x) => x.id === c.workerId)
          const load = loadOf(c.workerId)
          const pulling = pulled.includes(c.workerId) && load?.busy
          const fillIn = workers.items.find((x) => x.id === fillIns[c.workerId])
          const warning = pulling
            ? tx('יעבור לכאן מהעבודה {v} כשתשמור{v2}', { v: otherText(c.workerId), v2: fillIn ? tx(', ושם ייכנס במקומו {v}', { v: fullName(fillIn) }) : tx(', ושם יישאר מקום ריק') })
            : load && loadWarning(load)
          // The replacement must fit the places this worker fills: their certifications.
          // One who covers places of two kinds is replaced by one who fits both, or else by one who fits their own place.
          const mine = cover.get(c.workerId)?.map((s) => draft.staffing[s]) ?? [{}]
          const fitsAll = (x: Worker) => mine.every((p) => fitsSlot(x, p))
          const fitsOwn = (x: Worker) => fitsSlot(x, mine[0])
          // The place they fill, when it asks for a certification: "טיפוס".
          const placeLabel = slotCerts(mine[0]).length ? placeText(mine[0], certs.items) : ''
          const fit = [...available, ...others].some((x) => fitsAll(x.worker)) ? fitsAll : fitsOwn
          const swapOptions = available.filter((x) => fit(x.worker))
          const busyOptions = others.filter((x) => fit(x.worker))
          return (
            // A constraint keeps this worker out on the shift's day: outlined in orange, swap is right there.
            <div key={c.workerId} className={`rounded-xl bg-slate-950 p-2 ${load?.blocked ? 'border-2 border-orange-500' : 'border border-slate-800'}`}>
              <div className="flex items-center gap-2">
              {pinned.includes(c.workerId) && <Lock size={14} className="ms-1 shrink-0 text-emerald-300" aria-label={tx('חייב להיות בעבודה')} />}
              <WorkerDial worker={w} className="min-h-11 min-w-0 flex-1 ps-1" />
              {placeLabel && <span className="max-w-[40%] shrink-0 truncate text-xs text-slate-400">{placeLabel}</span>}
              <button
                type="button"
                aria-label={tx('החלפת {v} בעובד אחר', { v: w ? fullName(w) : tx('העובד') })}
                aria-expanded={swapping === c.workerId}
                onClick={() => setSwapping((s) => (s === c.workerId ? null : c.workerId))}
                className="flex size-11 items-center justify-center rounded-lg text-slate-400"
              >
                <ArrowLeftRight size={18} aria-hidden />
              </button>
              <button
                type="button"
                aria-label={tx('הוצאה מהעבודה')}
                onClick={() => set('crew', draft.crew.filter((_, j) => j !== i))}
                className="flex size-11 items-center justify-center rounded-lg text-slate-400"
              >
                <X size={18} aria-hidden />
              </button>
              </div>
              {warning && (
                <p className={`ps-1 text-xs ${load?.blocked ? 'text-orange-300' : 'text-amber-300'}`}>
                  {warning}
                  {load?.blocked && tx(' · אפשר להחליף בכפתור החצים')}
                </p>
              )}
              {swapping === c.workerId &&
                (swapOptions.length || busyOptions.length ? (
                  <select
                    aria-label={tx('במקום {v}', { v: w ? fullName(w) : tx('העובד') })}
                    value=""
                    onChange={(e) => choose(e.target.value, (id) => swap(i, id))}
                    className={`${inputClass} mt-2 text-slate-300`}
                  >
                    <option value="">{tx('במקומו...')}</option>
                    {swapOptions.map(({ worker: x, load: l }) => (
                      <option key={x.id} value={x.id}>
                        {pickLabel(x, l)}
                      </option>
                    ))}
                    {busyOptions.length > 0 && (
                      <optgroup label={tx('מתאימים, אבל בעבודה אחרת באותו זמן')}>
                        {busyOptions.map(({ worker: x }) => (
                          <option key={x.id} value={x.id}>
                            {tx('{v} · בעבודה {v2}', { v: fullName(x), v2: otherText(x.id) })}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                ) : (
                  <p className="mt-2 ps-1 text-xs text-slate-400">{tx('אין עובד פנוי אחר עם ההסמכות של המקום הזה')}</p>
                ))}
            </div>
          )
        })}
        {workers.items.length > 0 && draft.crew.length === 0 && <p className="text-sm text-slate-400">{tx('לחץ "שבץ" והמערכת תבחר את העובדים לבד.')}</p>}
        {asking && (
          <PullConfirm
            pulls={[{ worker: asking.worker, other: asking.other }]}
            exclude={draft.crew.map((c) => c.workerId).concat(Object.values(fillIns))}
            onYes={(chosen) => (asking.apply(), setFillIns((f) => ({ ...f, ...chosen })), setAsking(null))}
            onNo={() => setAsking(null)}
          />
        )}
        {draft.crew.length > 0 && available.length + others.length > 0 ? (
          <select
            aria-label={tx('הוספת עובד לעבודה')}
            value=""
            onChange={(e) => choose(e.target.value, addWorker)}
            className={`${inputClass} text-slate-300`}
          >
            <option value="">{tx('+ הוספת עובד')}</option>
            {available.map(({ worker: w, load }) => (
              <option key={w.id} value={w.id}>
                {pickLabel(w, load)}
              </option>
            ))}
            {others.length > 0 && (
              <optgroup label={tx('בעבודה אחרת באותו זמן')}>
                {others.map(({ worker: w }) => (
                  <option key={w.id} value={w.id}>
                    {tx('{v} · בעבודה {v2}', { v: fullName(w), v2: otherText(w.id) })}</option>
                ))}
              </optgroup>
            )}
          </select>
        ) : (
          workers.items.length === 0 && <p className="text-sm text-amber-300">{tx('עוד אין עובדים. אפשר להוסיף אותם בלשונית "עובדים".')}</p>
        )}
        {workers.items.length > 0 && (
          <button
            type="button"
            onClick={plan}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-sky-500 bg-sky-500/15 text-sm font-medium text-sky-300"
          >
            <Sparkles size={18} aria-hidden />
            {draft.crew.length ? tx('שבץ את המקומות החסרים') : tx('שבץ')}
          </button>
        )}
        {planNote && (
          <div role="status" className="space-y-1 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
            <p className="font-medium">{tx('לא נמצא עובד לכל המקומות:')}</p>
            {planNote.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        )}
      </div>

      {listedBusy.length > 0 && (
        <ul data-busy-list className="space-y-2" aria-label={tx('עובדים שכבר משובצים בעבודה אחרת')}>
          {listedBusy.map((b) => (
            <li key={b.worker.id} className="space-y-2 rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-100">
              <p>{busyText([b])}</p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-amber-500/20 px-2 py-1 text-xs">{tx('יעבור לכאן')}</span>
                <button type="button" onClick={() => keepThere(b.worker.id)} className="min-h-11 rounded-xl border border-slate-600 px-3 text-slate-100">
                  {tx('להשאיר אותו שם')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <SheetActions
        onSave={save}
        onCancel={onDone}
        onDelete={exists ? remove : undefined}
        deleteWarning={tx('לבטל את העבודה? היא תימחק מהיומן{v}.', { v: shift.fromJobId ? tx(' ותחזור לרשימת העבודות שמחכות ליום') : '' })}
        deleteLabel={tx('ביטול עבודה')}
        confirmLabel={tx('כן, לבטל')}
        busy={busy}
        error={error}
        // Notes that name no field: the day to pick, or the workers busy elsewhere.
        errorTarget={autoDate && !autoPicked ? '[data-auto-date]' : listedBusy.length ? '[data-busy-list]' : undefined}
        saveError={saveError}
      />
    </>
  )
}
