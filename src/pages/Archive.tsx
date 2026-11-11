import { tx } from '../i18n'
import { useState } from 'react'
import { ArrowLeftRight, Loader2, Search } from 'lucide-react'
import { DateField } from '../components/DateField'
import { DriveError } from '../components/DriveError'
import { Field, inputClass } from '../components/Sheet'
import { fullName, tagNames } from '../lib/catalog'
import { RANGES, archivePlaces, archiveShifts, archiveSummary, rangeDates, taskLinks } from '../lib/archive'
import type { ArchiveFilter } from '../lib/archive'
import { useDriveList, useWholeHistory } from '../lib/data/useDriveList'
import { todayIso } from '../lib/dates'
import { defaultMonth, monthDates } from '../lib/monthReport'
import { dayName, showDate } from '../lib/shifts'
import { defaultWeek, weekDates } from '../lib/weekReport'
import type { ShiftRecord } from '../types/models'
import { OUTCOMES } from './calendar/outcomes'
import { MonthReport, WeekReport } from './archive/PeriodReport'

// The whole history of shifts: who worked, where, what the job was, how a night job ended and
// who was swapped. Read-only; a shift is changed from "יומן".

const PAGE = 50

const fullDate = (d: string) => `${showDate(d)}.${d.slice(0, 4)}`

const NONE = '__none' // the worker select's placeholder: no worker and not "all" either

export function Archive() {
  const shifts = useDriveList('shifts')
  const older = useWholeHistory() // the app opens with 3 months; the archive reads the older ones too
  const workers = useDriveList('workers')
  const lists = [shifts, workers, useDriveList('shiftDefinitions'), useDriveList('pendingJobs'), useDriveList('postponeReasons')]
  const loading = lists.some((l) => l.query.isPending)
  const failed = lists.find((l) => l.query.isError)
  const today = todayIso()
  const [range, setRange] = useState<string>('month')
  const [filter, setFilter] = useState<ArchiveFilter>(() => ({ ...rangeDates(30, today), workerId: undefined, location: '', text: '' }))
  const [shown, setShown] = useState(PAGE)
  const [mode, setMode] = useState<'list' | 'week' | 'month'>('list')
  const [month, setMonth] = useState(() => defaultMonth(today))
  const [week, setWeek] = useState(() => defaultWeek(today))

  const set = (patch: Partial<ArchiveFilter>) => (setFilter((f) => ({ ...f, ...patch })), setShown(PAGE))
  const showWorker = (workerId: string, dates: { from: string; to: string }) => (setMode('list'), setRange(''), set({ ...dates, workerId, location: '', text: '' }))
  // Nothing until a worker or "כל העובדים" is picked (workerId undefined = not picked yet, '' = all workers).
  const picked = filter.workerId !== undefined
  const hits = picked ? archiveShifts(shifts.items, filter, workers.items) : []
  const sum = archiveSummary(hits)
  const places = archivePlaces(shifts.items)
  const sortedWorkers = [...workers.items].sort((a, b) => fullName(a).localeCompare(fullName(b), 'he'))

  return (
    <section className="space-y-4 px-4 pt-6">
      <h1 className="text-2xl font-bold">{tx('ארכיון')}</h1>
      <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-800 bg-slate-900 p-1" role="group" aria-label={tx('תצוגה')}>
        {(
          [
            ['list', tx('עבודות')],
            ['week', tx('דוח שבועי')],
            ['month', tx('דוח חודשי')],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={mode === id}
            onClick={() => setMode(id)}
            className={`min-h-11 rounded-lg text-sm font-semibold ${mode === id ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {older && !loading && !failed && (
        <p className="flex items-center gap-2 text-sm text-slate-400" role="status">
          <Loader2 className="animate-spin" size={16} aria-hidden />
          {tx('טוען גם את העבודות הישנות...')}
        </p>
      )}
      {failed ? (
        <DriveError error={failed.query.error} action="load" onRetry={() => lists.forEach((l) => l.query.isError && l.query.refetch())} />
      ) : loading ? (
        <p className="flex items-center gap-2 text-slate-400">
          <Loader2 className="animate-spin" size={18} aria-hidden />
          {tx('טוען מגוגל דרייב...')}
        </p>
      ) : mode === 'month' ? (
        <MonthReport month={month} today={today} onMonth={setMonth} onWorker={(id) => showWorker(id, monthDates(month, today))} />
      ) : mode === 'week' ? (
        <WeekReport week={week} today={today} onWeek={setWeek} onWorker={(id) => showWorker(id, weekDates(week, today))} />
      ) : (
        <>
          <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <div className="flex flex-wrap gap-2" role="group" aria-label={tx('טווח מהיר')}>
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={range === r.id}
                  onClick={() => (setRange(r.id), set(rangeDates(r.days, today)))}
                  className={`min-h-11 rounded-full border px-4 text-sm ${range === r.id ? 'border-sky-500 bg-sky-500/15 text-sky-300' : 'border-slate-700 text-slate-300'}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <DateField label={tx('מתאריך')} value={filter.from} max={filter.to || undefined} onChange={(from, ok) => ok && (setRange(''), set({ from }))} />
              <DateField label={tx('עד תאריך')} value={filter.to} min={filter.from || undefined} onChange={(to, ok) => ok && (setRange(''), set({ to }))} />
            </div>
            <Field label={tx('עובד')}>
              <select value={filter.workerId ?? NONE} onChange={(e) => set({ workerId: e.target.value })} className={inputClass}>
                <option value={NONE} disabled hidden>
                  {tx('בחר עובד')}
                </option>
                <option value="">{tx('כל העובדים')}</option>
                {sortedWorkers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {fullName(w)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={tx('מקום')}>
              <select value={filter.location} onChange={(e) => set({ location: e.target.value })} className={inputClass}>
                <option value="">{tx('כל המקומות')}</option>
                {places.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={tx('חיפוש חופשי')}>
              <span className="relative block">
                <Search size={16} aria-hidden className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="search"
                  value={filter.text}
                  onChange={(e) => set({ text: e.target.value })}
                  placeholder={tx('מהות עבודה, הערה, שם...')}
                  className={`${inputClass} ps-9`}
                />
              </span>
            </Field>
          </div>

          <p role="status" className="text-sm text-slate-300">
            {!picked ? (
              tx('בחר עובד או "כל העובדים" כדי לראות עבודות')
            ) : sum.shifts === 0 ? (
              tx('אין עבודות שמתאימות לחיפוש')
            ) : (
              <>
                <span className="font-semibold">{sum.shifts === 1 ? tx('עבודה אחת') : tx('{shifts} עבודות', { shifts: sum.shifts })}</span>
                {[
                  sum.urgent && tx('{urgent} דחופות', { urgent: sum.urgent }),
                  sum.done && tx('{done} בוצעו', { done: sum.done }),
                  sum.partial && tx('{partial} חלקית', { partial: sum.partial }),
                  sum.postponed && tx('{postponed} נדחו', { postponed: sum.postponed }),
                  sum.swaps && tx('{swaps} החלפות', { swaps: sum.swaps }),
                ]
                  .filter(Boolean)
                  .map((t) => ` · ${t}`)}
              </>
            )}
          </p>

          <ul className="space-y-2">
            {hits.slice(0, shown).map((r) => (
              <li key={r.id}>
                <ArchiveCard shift={r} today={today} />
              </li>
            ))}
          </ul>
          {hits.length > shown && (
            <button type="button" onClick={() => setShown((n) => n + PAGE)} className="min-h-12 w-full rounded-xl border border-slate-700 text-sm text-slate-200">
              {tx('עוד {v} עבודות (מתוך {v2} שנשארו)', { v: Math.min(PAGE, hits.length - shown), v2: hits.length - shown })}</button>
          )}
        </>
      )}
    </section>
  )
}

function ArchiveCard({ shift: r, today }: { shift: ShiftRecord; today: string }) {
  const shifts = useDriveList('shifts')
  const defs = useDriveList('shiftDefinitions')
  const workers = useDriveList('workers')
  const jobs = useDriveList('pendingJobs')
  const reasons = useDriveList('postponeReasons')
  const def = defs.items.find((d) => d.id === r.shiftDefinitionId)
  const outcome = OUTCOMES.find((o) => o.id === r.closure?.outcome)
  const name = (id: string) => {
    const w = workers.items.find((x) => x.id === id)
    return w ? fullName(w) : tx('עובד שנמחק')
  }
  const { left, next, prev } = taskLinks(r, shifts.items, jobs.items)
  const reasonText = r.closure ? tagNames(r.closure.reasonIds, reasons.items).join(', ') : ''

  return (
    <article className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <header className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-sm font-semibold text-slate-200">
          {tx('יום {weekday} {v2}', { weekday: dayName(r.date), v2: fullDate(r.date) })}</span>
        {r.date > today && <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-sky-300">{tx('עתידית')}</span>}
        {r.urgent && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-semibold text-amber-300">{tx('דחופה מ-{startTime}', { startTime: r.startTime })}</span>}
        {def && <span className="rounded-full bg-slate-800 px-2 py-0.5 text-slate-300">{def.name}</span>}
        {outcome && <span className={`rounded-full border px-2 py-0.5 font-semibold ${outcome.tone}`}>{outcome.label}</span>}
      </header>
      {r.location && <p className="font-semibold">{r.location}</p>}
      {r.jobDescription && <p className="whitespace-pre-line text-sm text-slate-300">{r.jobDescription}</p>}

      {r.crew.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {r.crew.map((c) => (
            <li key={c.workerId} className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-200">
              {name(c.workerId)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-amber-300">{tx('לא שובצו עובדים')}</p>
      )}

      {(r.swaps ?? []).map((s, i) => (
        <p key={i} className="flex items-center gap-1.5 text-xs text-slate-400">
          <ArrowLeftRight size={14} aria-hidden className="shrink-0" />
          {name(s.inId)} {tx('במקום')}{' '}{name(s.outId)}
          {tx(', הוחלף ב-')}{fullDate(s.at.slice(0, 10))}
        </p>
      ))}

      {r.closure && (reasonText || r.closure.note || r.closure.followUp) && (
        <div className="space-y-0.5 rounded-xl bg-slate-950 p-3 text-xs text-slate-300">
          {reasonText && <p>{tx('סיבה: {reasonText}', { reasonText })}</p>}
          {r.closure.note && <p className="whitespace-pre-line">{tx('הערת סגירה: {note}', { note: r.closure.note })}</p>}
          {r.closure.followUp && <p>{tx('משימת המשך: {v}', { v: [r.closure.followUp.location, r.closure.followUp.jobDescription].filter(Boolean).join(' · ') })}</p>}
        </div>
      )}

      {prev && <p className="text-xs text-sky-300">{tx('המשך של עבודה מיום {weekday} {v2}', { weekday: dayName(prev.date), v2: fullDate(prev.date) })}</p>}
      {left && r.closure && r.closure.outcome !== 'done' && (
        <p className="text-xs text-sky-300">{next ? tx('ההמשך שובץ ליום {weekday} {v2}', { weekday: dayName(next.date), v2: fullDate(next.date) }) : tx('ההמשך עדיין מחכה בלשונית "לשיבוץ"')}</p>
      )}
    </article>
  )
}
