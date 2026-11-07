import { useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { dayNames, tx } from '../../i18n'
import { constraintText } from '../../lib/constraints'
import { useDriveList } from '../../lib/data/useDriveList'
import { todayIso } from '../../lib/dates'
import { addDays, showDate, weekday } from '../../lib/shifts'
import { agendaText, workerAgenda, type AgendaItem } from '../../lib/workerAgenda'
import type { Worker } from '../../types/models'

const SHORT_DAYS = dayNames('short')
const FIRST = 4 // shown before "show all", so the form stays short on a phone

/** The worker's own calendar in their card: upcoming jobs and days away, from today on. */
export function WorkerAgenda({ worker }: { worker: Worker }) {
  const shifts = useDriveList('shifts')
  const defs = useDriveList('shiftDefinitions')
  const roles = useDriveList('roles')
  const [all, setAll] = useState(false)
  const today = todayIso()
  const { dated, weekly } = workerAgenda(worker, shifts.items, defs.items, today)
  const shown = all ? dated : dated.slice(0, FIRST)
  const jobs = dated.filter((i) => i.type === 'job').length

  const when = (date: string) => (date === today ? tx('היום') : date === addDays(today, 1) ? tx('מחר') : SHORT_DAYS[weekday(date)])

  const row = (item: AgendaItem) => {
    const { title, detail } = agendaText(item, roles.items)
    const job = item.type === 'job'
    const def = job ? defs.items.find((d) => d.id === item.shift.shiftDefinitionId)?.name : undefined
    const kind = job ? (item.shift.urgent ? tx('עבודה דחופה') : def) : undefined
    const until = job && item.endDate !== item.date ? tx('עד {v}', { v: showDate(item.endDate) }) : ''
    const tone = !job ? (item.type === 'away' && item.sick ? 'border-rose-400' : 'border-amber-400') : 'border-sky-400'
    return (
      <li key={item.key} className={`flex gap-3 border-s-2 ${tone} ps-3`}>
        <span className="w-12 shrink-0 text-center leading-tight">
          <span className="block text-xs text-slate-400">{when(item.date)}</span>
          <span className="block text-sm font-semibold text-slate-100">{showDate(item.date)}</span>
        </span>
        <span className="min-w-0 flex-1 text-sm leading-snug">
          <span className={`block ${job ? 'text-slate-100' : 'text-amber-200'} ${!job && item.sick ? 'text-rose-200' : ''}`}>
            {job ? title || tx('עבודה') : title}
          </span>
          {job && (
            <span className="block text-xs text-slate-400">
              {[kind, detail, until].filter(Boolean).join(' · ')}
            </span>
          )}
        </span>
      </li>
    )
  }

  return (
    <section aria-label={tx('הלוח האישי')} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
        <CalendarDays size={16} aria-hidden className="text-sky-300" />
        {tx('הלוח האישי')}
        <span className="text-xs font-normal text-slate-400">
          {tx('{n} עבודות קרובות', { n: jobs })}
        </span>
      </h3>
      {shifts.query.isPending ? (
        <p className="text-sm text-slate-400">{tx('טוען...')}</p>
      ) : dated.length === 0 && weekly.length === 0 ? (
        <p className="text-sm text-slate-400">{tx('אין עבודות או היעדרויות מהיום והלאה.')}</p>
      ) : (
        <>
          {dated.length > 0 && <ul className="space-y-2.5">{shown.map(row)}</ul>}
          {dated.length > FIRST && (
            <button type="button" onClick={() => setAll((v) => !v)} className="min-h-10 text-sm font-semibold text-sky-300">
              {all ? tx('להציג פחות') : tx('להציג הכל ({n})', { n: dated.length })}
            </button>
          )}
          {weekly.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs text-slate-400">{tx('קבוע כל שבוע')}</span>
              <span className="flex flex-wrap gap-1">
                {weekly.map((c) => (
                  <span key={c.id} className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-200">
                    {constraintText(c)}
                  </span>
                ))}
              </span>
            </div>
          )}
        </>
      )}
    </section>
  )
}
