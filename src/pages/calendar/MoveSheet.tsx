import { tx } from '../../i18n'
import { useMemo, useState } from 'react'
import { Check, Lightbulb } from 'lucide-react'
import { DateField } from '../../components/DateField'
import { Sheet, SheetActions } from '../../components/Sheet'
import { fullName, generalRoleId, upsert } from '../../lib/catalog'
import { blockedCrew, constraintText } from '../../lib/constraints'
import { shiftGaps, type GapContext } from '../../lib/gaps'
import { ADVICE_DAYS, fitsAsIs, MAX_SWAPS, moveAdvice, swapOn, swapRecords, type MoveAdvice, type SwapAdvice } from '../../lib/moveAdvice'
import { busyCrew, busyText, pullFrom } from '../../lib/planner'
import { useDriveList } from '../../lib/data/useDriveList'
import { todayIso } from '../../lib/dates'
import { addDays, dayName, isNightShift, moveShift, showDate, weekOf } from '../../lib/shifts'
import type { Role, ShiftRecord, Worker } from '../../types/models'
import { PullConfirm } from './PullConfirm'

// Move a whole shift, workers and all, to another day. The phone-friendly way; on a computer the
// card can also be dragged onto a day.

export function MoveSheet({ shift, onClose }: { shift: ShiftRecord | null; onClose: () => void }) {
  const shifts = useDriveList('shifts')
  return (
    <Sheet open={shift !== null} title={tx('העברת עבודה ליום אחר')} onClose={onClose} locked={shifts.saving}>
      {shift && <MoveForm key={shift.id} shift={shift} onDone={onClose} />}
    </Sheet>
  )
}

function MoveForm({ shift, onDone }: { shift: ShiftRecord; onDone: () => void }) {
  const shifts = useDriveList('shifts')
  const defs = useDriveList('shiftDefinitions')
  const workers = useDriveList('workers')
  const roles = useDriveList('roles')
  const certs = useDriveList('certifications')
  const [date, setDate] = useState(shift.date)
  const [valid, setValid] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const moved = moveShift(shift, date)
  const blocked = valid && date !== shift.date ? blockedCrew(moved, workers.items, defs.items) : []
  // A worker cannot be in two shifts at the same time: that move is refused until they are swapped.
  const clashes = valid && date !== shift.date ? busyCrew(moved, workers.items, shifts.items, defs.items) : []
  // Quick picks: the shift's week and the week after it. Any other day goes through the date field.
  // A job never moves into the past, so past days are not offered.
  const today = todayIso()
  const days = [...weekOf(shift.date).days, ...weekOf(addDays(shift.date, 7)).days].filter((d) => d >= today || d === shift.date)
  const gapCtx: GapContext = useMemo(
    () => ({
      workers: workers.items,
      records: shifts.items,
      defs: defs.items,
      roles: roles.items,
      certifications: certs.items,
      generalId: generalRoleId(roles.items),
    }),
    [workers.items, shifts.items, defs.items, roles.items, certs.items],
  )
  // Days the job fits on with the same crew are marked; a job with problems also gets advice.
  const fitDays = new Set(days.filter((d) => d !== shift.date && fitsAsIs(shift, d, gapCtx)))
  const troubled = shiftGaps(shift, gapCtx).kinds.some((k) => k !== 'nights')
  const advice = useMemo(() => (troubled ? moveAdvice(shift, today, gapCtx) : null), [troubled, shift, gapCtx, today])
  // Once another day is picked, the top box speaks about that day, not the job's own.
  const chosen = valid && date !== shift.date && date >= today
  const pickedFits = chosen && fitsAsIs(shift, date, gapCtx)
  const dayFix = chosen && !pickedFits ? (swapOn(shift, date, gapCtx) ?? swapOn(shift, date, gapCtx, true)) : null
  const pick = (d: string) => (setDate(d), setValid(true))

  const saveSwap = async (swap: SwapAdvice, fillIns: Record<string, string> = {}) => {
    setError(null)
    setBusy(true)
    setSaveError(null)
    try {
      const at = new Date().toISOString()
      const history = [...(shift.swaps ?? []), ...swapRecords(swap.swaps, at)]
      const next = { ...swap.shift, ...(history.length ? { swaps: history } : {}) }
      // A worker taken out of another job leaves it in the same save, with the fill-in the manager picked.
      const pulled = swap.swaps.flatMap((x) => (x.from ? [x.in.id] : []))
      await shifts.save(pullFrom(next, pulled, upsert(shifts.items, next), defs.items, fillIns, at))
      onDone()
    } catch (e) {
      setSaveError(e)
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    const err = !valid
      ? tx('התאריך לא תקין')
      : date === shift.date
        ? tx('בחר יום אחר מהיום של העבודה')
        : date < today
          ? tx('אי אפשר להעביר עבודה ליום שכבר עבר')
          : clashes.length
          ? tx('{v}. אי אפשר להעביר: קודם החלף {v2} בעריכת העבודה.', { v: busyText(clashes), v2: clashes.length > 1 ? tx('אותם') : tx('אותו') })
          : null
    setError(err)
    if (err) return
    setBusy(true)
    setSaveError(null)
    try {
      await shifts.save(upsert(shifts.items, moved))
      onDone()
    } catch (e) {
      setSaveError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="text-sm text-slate-300">
        {tx('העבודה עוברת עם כל העובדים שבה. {v}', { v: isNightShift(shift, defs.items) && tx(' עבודת לילה ממשיכה גם ביום שאחריו, כמו קודם.') })}</p>
      {chosen ? (
        pickedFits ? (
          <p role="status" className="rounded-xl border border-emerald-500/60 bg-emerald-500/10 p-3 text-sm text-emerald-200">
            {tx('ביום {weekday} {v2} כל העובדים זמינים וכל המקומות בעבודה מלאים. אפשר ללחוץ "העברה".', { weekday: dayName(date), v2: showDate(date) })}</p>
        ) : (
          <div role="status" className="space-y-3 rounded-xl border border-orange-500/60 bg-orange-500/10 p-3 text-sm text-orange-100">
            <p className="font-semibold">
              {tx('ביום {weekday} {v2} העבודה לא מסתדרת עם אותם עובדים.', { weekday: dayName(date), v2: showDate(date) })}</p>
            {dayFix ? (
              <SwapChoice swap={dayFix} title={tx('כדי שתסתדר ביום הזה')} roles={roles.items} workers={workers.items} busy={busy} onSwap={saveSwap} />
            ) : (
              <p>{tx('גם עם החלפה של עד {MAX_SWAPS} עובדים אי אפשר להשלים אותה ביום הזה.', { MAX_SWAPS })}</p>
            )}
          </div>
        )
      ) : (
        advice && <AdviceBox advice={advice} roles={roles.items} workers={workers.items} busy={busy} onPick={pick} onSwap={saveSwap} />
      )}
      <div className="flex flex-wrap gap-2">
        {days.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={date === d}
            onClick={() => pick(d)}
            className={`flex min-h-11 items-center gap-1 rounded-full border px-3 text-sm ${
              date === d
                ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                : fitDays.has(d)
                  ? 'border-emerald-500/70 bg-emerald-500/10 text-emerald-200'
                  : 'border-slate-700 text-slate-300'
            }`}
          >
            {fitDays.has(d) && <Check size={14} aria-label={tx('מתאים עם אותם עובדים')} />}
            {dayName(d)} {showDate(d)}
            {d === shift.date && tx(' (עכשיו)')}
          </button>
        ))}
      </div>
      {fitDays.size > 0 && <p className="text-xs text-emerald-300">{tx('ימים עם סימן וי: העבודה מתאימה בהם עם אותם עובדים, בלי להחליף אף אחד.')}</p>}
      <DateField label={tx('או תאריך אחר')} value={date} min={today} required onChange={(d, ok) => (setDate(d), setValid(ok))} />
      {clashes.length > 0 && (
        <p role="status" className="rounded-xl border border-red-500/60 bg-red-500/10 p-3 text-sm text-red-200">
          {tx('{v}. עובד לא יכול להיות בשתי עבודות באותו זמן.', { v: busyText(clashes) })}</p>
      )}
      {blocked.length > 0 && (
        <div role="status" className="space-y-1 rounded-xl border border-orange-500/60 bg-orange-500/10 p-3 text-sm text-orange-200">
          <p className="font-medium">{tx('ביום הזה יש לעובדים האלה אילוץ:')}</p>
          {blocked.map(({ worker, constraint }) => (
            <p key={worker.id}>
              {fullName(worker)}: {constraintText(constraint)}
              {constraint.note && ` (${constraint.note})`}
            </p>
          ))}
          <p className="text-orange-300">{tx('אפשר להעביר בכל זאת, ואז להחליף אותם בעריכת העבודה.')}</p>
        </div>
      )}
      <SheetActions onSave={save} onCancel={onDone} saveLabel={tx('העברה')} busy={busy} error={error} saveError={saveError} />
    </>
  )
}

// The earliest day a swap makes the job fit (with the swaps, and a button that does it), and the
// earliest day it fits with the same crew.
function AdviceBox({
  advice,
  roles,
  workers,
  busy,
  onPick,
  onSwap,
}: {
  advice: MoveAdvice
  roles: Role[]
  workers: Worker[]
  busy: boolean
  onPick: (date: string) => void
  onSwap: (swap: SwapAdvice, fillIns?: Record<string, string>) => void
}) {
  const when = (d: string) => tx('יום {weekday} {v2}', { weekday: dayName(d), v2: showDate(d) })
  const { fitDate, swap, pull } = advice
  return (
    <div role="status" className="space-y-3 rounded-xl border border-sky-500/60 bg-sky-500/10 p-3 text-sm text-sky-100">
      <p className="flex items-center gap-2 font-semibold">
        <Lightbulb size={16} aria-hidden />
        {tx('המלצה להעברה')}
      </p>
      {pull && <SwapChoice swap={pull} title={tx('הכי מוקדם, אם מעבירים עובד מעבודה אחרת')} roles={roles} workers={workers} busy={busy} onSwap={onSwap} />}
      {swap && <SwapChoice swap={swap} title={pull ? tx('בלי לגעת בעבודות אחרות') : tx('הכי מוקדם')} roles={roles} workers={workers} busy={busy} onSwap={onSwap} />}
      {fitDate ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p>
            {swap || pull ? tx('בלי להחליף אף אחד') : tx('היום הכי קרוב שמתאים עם אותם עובדים')}: <strong>{when(fitDate)}</strong>
          </p>
          <button type="button" onClick={() => onPick(fitDate)} className="min-h-11 rounded-xl border border-sky-500 px-4 font-semibold text-sky-200">
            {tx('לבחור את היום הזה')}
          </button>
        </div>
      ) : (
        <p className="text-sky-200">
          {swap || pull
            ? tx('בלי להחליף אף אחד אין יום מתאים ב-{ADVICE_DAYS} הימים הקרובים.', { ADVICE_DAYS })
            : tx('לא מצאתי יום מתאים ב-{ADVICE_DAYS} הימים הקרובים, גם לא עם החלפה של עד {MAX_SWAPS} עובדים.', { ADVICE_DAYS, MAX_SWAPS })}
        </p>
      )}
    </div>
  )
}

// A swap to offer; one that takes a worker out of another job asks first.
function SwapChoice(props: {
  swap: SwapAdvice
  title: string
  roles: Role[]
  workers: Worker[]
  busy: boolean
  onSwap: (swap: SwapAdvice, fillIns?: Record<string, string>) => void
}) {
  const { swap, onSwap } = props
  const [asking, setAsking] = useState(false)
  const pulls = swap.swaps.flatMap((x) => (x.from ? [{ worker: x.in, other: x.from }] : []))
  return (
    <>
      <SwapOption {...props} onSwap={() => (pulls.length ? setAsking(true) : onSwap(swap))} />
      {asking && (
        <PullConfirm
          pulls={pulls}
          exclude={swap.shift.crew.map((c) => c.workerId)}
          onYes={(fillIns) => (setAsking(false), onSwap(swap, fillIns))}
          onNo={() => setAsking(false)}
        />
      )}
    </>
  )
}

function SwapOption({
  swap,
  title,
  roles,
  workers,
  busy,
  onSwap,
}: {
  swap: SwapAdvice
  title: string
  roles: Role[]
  workers: Worker[]
  busy: boolean
  onSwap: () => void
}) {
  const when = (d: string) => tx('יום {weekday} {v2}', { weekday: dayName(d), v2: showDate(d) })
  const role = (id: string) => roles.find((r) => r.id === id)?.name
  const overNights = workers.filter((w) => swap.nightIds.includes(w.id))
  const many = swap.swaps.length > 1
  return (
    <div className="space-y-2">
      <p>
        {title}: <strong>{when(swap.date)}</strong>{tx(', עם')}{' '}{many ? tx('ההחלפות האלה') : tx('ההחלפה הזו')}:
      </p>
      <ul className="space-y-1">
        {swap.swaps.map((s) => (
          <li key={s.in.id} className="rounded-lg bg-slate-900/60 px-3 py-2">
            {s.out ? (
              <>
                {tx('במקום')}{' '}<strong>{fullName(s.out)}</strong> {tx('נכנס')}{' '}<strong>{fullName(s.in)}</strong>
              </>
            ) : (
              <>
                {tx('למקום הריק נכנס')}{' '}<strong>{fullName(s.in)}</strong>
              </>
            )}
            {role(s.roleId) && <span className="text-sky-300"> ({role(s.roleId)})</span>}
            {s.from && (
              <span className="block text-xs text-orange-300">
                {tx('עובר מהעבודה ביום {weekday} {v2}{v3}', { weekday: dayName(s.from.date), v2: showDate(s.from.date), v3: s.from.location && ` (${s.from.location})` })}</span>
            )}
          </li>
        ))}
        {swap.dropped.map((w) => (
          <li key={w.id} className="rounded-lg bg-slate-900/60 px-3 py-2">
            <strong>{fullName(w)}</strong> {tx('יוצא מהעבודה')}
          </li>
        ))}
      </ul>
      {overNights.length > 0 && <p className="text-orange-200">{tx('שים לב: {v} כבר עם הרבה לילות השבוע.', { v: overNights.map(fullName).join(', ') })}</p>}
      <button type="button" disabled={busy} onClick={onSwap} className="min-h-11 w-full rounded-xl bg-sky-600 px-4 font-semibold text-white disabled:opacity-60">
        {tx('להעביר ל{v} עם {v2}', { v: when(swap.date), v2: many ? tx('ההחלפות') : tx('ההחלפה') })}</button>
    </div>
  )
}
