import { tx } from '../../i18n'
import { useMemo, useState } from 'react'
import { CalendarCheck, ChevronDown } from 'lucide-react'
import { todayIso } from '../../lib/dates'
import type { GapContext } from '../../lib/gaps'
import { ADVICE_DAYS } from '../../lib/moveAdvice'
import { NIGHT_LIMIT } from '../../lib/planner'
import { fullNames, MAX_DATE_OPTIONS, nearestDates, type DateOption } from '../../lib/pinnedDates'
import { dayName, showDate } from '../../lib/shifts'
import type { ShiftRecord } from '../../types/models'

// "בחירה אוטומטית" of a new job's day (the user's request, 2026-11-13): once the manager says who the job
// needs, the app offers the 3 nearest days every place can be filled, with "עוד 3" for later ones. The
// same search as "מצא יום שכולם פנויים" (src/lib/pinnedDates.ts), with or without workers who must be in it.

export function AutoDate({ draft, ctx, picked, onPick }: { draft: ShiftRecord; ctx: GapContext; picked: string | null; onPick: (o: DateOption) => void }) {
  const [pages, setPages] = useState(1)
  const today = todayIso()
  // Only what changes the answer: who is needed, the template, the workers who must be in it.
  const key = JSON.stringify([draft.staffing, draft.shiftDefinitionId, draft.pinnedIds, pages])
  const options = useMemo(
    () => nearestDates({ ...draft, crew: draft.crew.filter((c) => draft.pinnedIds?.includes(c.workerId)) }, today, ctx, MAX_DATE_OPTIONS * pages),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, today, ctx.records, ctx.workers],
  )
  const more = options.length === MAX_DATE_OPTIONS * pages

  return (
    <div className="space-y-2 rounded-2xl border border-sky-500/40 bg-sky-500/10 p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-sky-200">
        <CalendarCheck size={18} aria-hidden />
        {tx('התאריכים הקרובים שאפשר לאייש את כל המקומות')}
      </p>
      {options.length === 0 ? (
        <p role="status" className="text-sm text-amber-200">
          {tx('לא מצאתי ב-{days} הימים הקרובים יום שיש בו מספיק עובדים לכל המקומות.', { days: ADVICE_DAYS })}
        </p>
      ) : (
        <ul className="space-y-2">
          {options.map((o) => {
            const on = picked === o.date
            const added = fullNames(o.addedIds, ctx.workers)
            const nights = fullNames(o.nightIds, ctx.workers)
            return (
              <li key={o.date}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onPick(o)}
                  className={`block w-full space-y-0.5 rounded-xl border p-3 text-start text-sm ${on ? 'border-sky-400 bg-sky-500/20' : 'border-slate-600 bg-slate-950'}`}
                >
                  <span className="block font-medium text-slate-100">
                    {tx('יום {weekday} {v2}', { weekday: dayName(o.date), v2: showDate(o.date) })}
                    {on && <span className="ms-2 text-xs text-sky-300">{tx('נבחר')}</span>}
                  </span>
                  {added.length > 0 && <span className="block text-xs text-slate-300">{tx('ישובצו: {v}', { v: added.join(', ') })}</span>}
                  {nights.length > 0 && <span className="block text-xs text-amber-300">{tx('שים לב: {v} כבר עם {n} לילות באותו שבוע', { v: nights.join(', '), n: NIGHT_LIMIT })}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {more && (
        <button
          type="button"
          onClick={() => setPages((p) => p + 1)}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-sky-500 text-sm font-medium text-sky-200"
        >
          <ChevronDown size={18} aria-hidden />
          {tx('עוד 3')}
        </button>
      )}
    </div>
  )
}
