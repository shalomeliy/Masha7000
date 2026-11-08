import { tx } from '../../i18n'
import { useState } from 'react'
import { CalendarSearch, Lock, X } from 'lucide-react'
import { inputClass } from '../../components/Sheet'
import { fullName, isActive } from '../../lib/catalog'
import { todayIso } from '../../lib/dates'
import type { GapContext } from '../../lib/gaps'
import { ADVICE_DAYS } from '../../lib/moveAdvice'
import { NIGHT_LIMIT } from '../../lib/planner'
import { datesForPinned, fullNames, pinnedOf, type DateOption } from '../../lib/pinnedDates'
import { dayName, showDate } from '../../lib/shifts'
import type { ShiftRecord } from '../../types/models'

// "עובדים שחייבים להיות": the manager names the workers this job cannot go without, and the app finds
// the nearest days all of them are free (HANDOFF.md, "pinned workers"). "שבץ" fills the other places
// around them and never takes them out.

// `onPick`: what picking a day does instead of setting it in this form (a waiting job opens the new shift with it).
export function PinnedField({
  draft,
  onChange,
  ctx,
  onPick,
}: {
  draft: ShiftRecord
  onChange: (next: Pick<ShiftRecord, 'crew' | 'pinnedIds'> & { date?: string }) => void
  ctx: GapContext
  onPick?: (o: DateOption) => void
}) {
  const pinned = pinnedOf(draft)
  const [options, setOptions] = useState<DateOption[] | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const workers = ctx.workers.filter(isActive).sort((a, b) => fullName(a).localeCompare(fullName(b), 'he'))
  const name = (id: string) => {
    const w = ctx.workers.find((x) => x.id === id)
    return w ? fullName(w) : ''
  }

  const add = (id: string) => {
    if (!ctx.workers.some((x) => x.id === id)) return
    const crew = draft.crew.some((c) => c.workerId === id) ? draft.crew : [...draft.crew, { workerId: id }]
    onChange({ crew, pinnedIds: [...pinned, id] })
    setOptions(null)
    setPicked(null)
  }
  // Taken off the list, the worker leaves the job too: he was put in only because he had to be.
  const remove = (id: string) => {
    onChange({ crew: draft.crew.filter((c) => c.workerId !== id), pinnedIds: pinned.filter((x) => x !== id) })
    setOptions(null)
    setPicked(null)
  }
  const search = () => {
    setOptions(datesForPinned(draft, pinned, todayIso(), ctx))
    setPicked(null)
  }
  const pick = (o: DateOption) => {
    if (onPick) return onPick(o)
    onChange({ date: o.date, crew: o.shift.crew, pinnedIds: pinned })
    setPicked(o.date)
    setOptions(null)
  }
  const others = workers.filter((w) => !pinned.includes(w.id))

  return (
    <div className="space-y-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-3">
      <p className="text-sm font-medium text-emerald-200">{tx('עובדים שחייבים להיות בעבודה')}</p>
      {pinned.length === 0 && <p className="text-xs text-slate-300">{tx('אפשר לבחור עובדים שהעבודה לא יוצאת בלעדיהם, והמערכת תמצא את הימים הקרובים שכולם פנויים בהם.')}</p>}
      {pinned.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {pinned.map((id) => (
            <li key={id} className="flex min-h-11 items-center gap-1 rounded-xl border border-emerald-400/60 bg-slate-950 ps-3 text-sm text-slate-100">
              <Lock size={14} className="text-emerald-300" aria-hidden />
              {name(id)}
              <button type="button" aria-label={tx('{v} לא חייב להיות בעבודה', { v: name(id) })} onClick={() => remove(id)} className="flex size-11 items-center justify-center text-slate-400">
                <X size={16} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <select aria-label={tx('הוספת עובד שחייב להיות בעבודה')} value="" onChange={(e) => add(e.target.value)} className={`${inputClass} text-slate-300`}>
          <option value="">{tx('+ עובד שחייב להיות')}</option>
          {others.map((w) => (
            <option key={w.id} value={w.id}>
              {fullName(w)}
            </option>
          ))}
        </select>
      )}
      {pinned.length > 0 && !draft.urgent && (
        <button
          type="button"
          onClick={search}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-500 bg-emerald-500/15 text-sm font-medium text-emerald-200"
        >
          <CalendarSearch size={18} aria-hidden />
          {pinned.length === 1 ? tx('מצא יום שהוא פנוי') : tx('מצא יום שכולם פנויים')}
        </button>
      )}
      {options && options.length === 0 && (
        <p role="status" className="text-sm text-amber-200">
          {tx('לא מצאתי ב-{days} הימים הקרובים יום שכולם פנויים בו ויש מספיק עובדים לשאר המקומות.', { days: ADVICE_DAYS })}
        </p>
      )}
      {options && options.length > 0 && (
        <div role="status" className="space-y-2">
          <p className="text-sm text-slate-200">{options.length === 1 ? tx('היום הקרוב שמתאים:') : tx('הימים הקרובים שמתאימים, בחר אחד:')}</p>
          {options.map((o) => {
            const added = fullNames(o.addedIds, ctx.workers)
            const nights = fullNames(o.nightIds, ctx.workers)
            return (
              <button key={o.date} type="button" onClick={() => pick(o)} className="block w-full space-y-0.5 rounded-xl border border-slate-600 bg-slate-950 p-3 text-start text-sm">
                <span className="block font-medium text-slate-100">{tx('יום {weekday} {v2}', { weekday: dayName(o.date), v2: showDate(o.date) })}</span>
                <span className="block text-xs text-slate-300">{added.length ? tx('ייכנסו גם: {v}', { v: added.join(', ') }) : tx('אין צורך בעוד עובדים')}</span>
                {nights.length > 0 && <span className="block text-xs text-amber-300">{tx('שים לב: {v} כבר עם {n} לילות באותו שבוע', { v: nights.join(', '), n: NIGHT_LIMIT })}</span>}
              </button>
            )
          })}
        </div>
      )}
      {picked && (
        <p role="status" className="text-sm text-emerald-200">
          {tx('קבעתי את העבודה ליום {weekday} {v2} עם הצוות. אפשר עוד לשנות לפני השמירה.', { weekday: dayName(picked), v2: showDate(picked) })}
        </p>
      )}
    </div>
  )
}
