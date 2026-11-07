import { CalendarDays, ChevronLeft, Pencil, X } from 'lucide-react'
import { dayNames, tx } from '../../i18n'
import { useDriveList } from '../../lib/data/useDriveList'
import { todayIso } from '../../lib/dates'
import { addDays, showDate, weekday } from '../../lib/shifts'
import { agendaDays, agendaText, workerAgenda, type AgendaDay, type AgendaItem } from '../../lib/workerAgenda'
import type { Worker } from '../../types/models'

const SHORT_DAYS = dayNames('short')

/** The worker's next 3 days: jobs and days away. Read in the form, so the constraints list can leave these out. */
export function useWorkerAgenda(worker: Worker) {
  const shifts = useDriveList('shifts')
  const defs = useDriveList('shiftDefinitions')
  return { items: workerAgenda(worker, shifts.items, defs.items, todayIso()), loading: shifts.query.isPending }
}

/** The worker's own calendar in their card. A constraint shown here is removed here (it is not in the list above). */
export function WorkerAgenda({
  items,
  loading,
  onRemove,
  onEditSick,
  onOpen,
}: {
  items: AgendaItem[]
  loading: boolean
  onRemove: (constraintId: string) => void // 'sick' ends the status sickness
  onEditSick: () => void // the status sheet, to change the sickness's last day
  onOpen: () => void // the worker's month
}) {
  const defs = useDriveList('shiftDefinitions')
  const roles = useDriveList('roles')
  const today = todayIso()
  const when = (date: string) => (date === today ? tx('היום') : date === addDays(today, 1) ? tx('מחר') : SHORT_DAYS[weekday(date)])

  // One thing on a day: a job (sky), sickness (red) or another absence (amber).
  const entry = (item: AgendaItem) => {
    const { title, detail } = agendaText(item, roles.items)
    const job = item.type === 'job'
    const sick = item.type === 'away' && item.sick
    const kind = job ? (item.shift.urgent ? tx('עבודה דחופה') : defs.items.find((d) => d.id === item.shift.shiftDefinitionId)?.name) : undefined
    const until = job && item.endDate !== item.date ? tx('עד {v}', { v: showDate(item.endDate) }) : ''
    return (
      <li key={item.key} className={`flex items-center gap-2 border-s-2 ps-3 ${job ? 'border-sky-400' : sick ? 'border-rose-400' : 'border-amber-400'}`}>
        <span className="min-w-0 flex-1 text-sm leading-snug">
          <span className={`block ${job ? 'text-slate-100' : sick ? 'text-rose-200' : 'text-amber-200'}`}>{job ? title || tx('עבודה') : title}</span>
          {job && <span className="block text-xs text-slate-400">{[kind, detail, until].filter(Boolean).join(' · ')}</span>}
        </span>
        {/* Sickness from today is the worker's status: the pencil changes its last day, the X ends it. */}
        {item.type === 'away' && item.key === 'sick' && (
          <button
            type="button"
            aria-label={tx('עריכת המחלה')}
            onClick={(e) => {
              e.stopPropagation()
              onEditSick()
            }}
            className="flex size-11 shrink-0 items-center justify-center text-slate-400"
          >
            <Pencil size={16} aria-hidden />
          </button>
        )}
        {item.type === 'away' && (
          <button
            type="button"
            aria-label={tx('מחיקת האילוץ: {v}', { v: title })}
            onClick={(e) => {
              e.stopPropagation() // not a tap on the box, which opens the month
              onRemove(item.constraint.id)
            }}
            className="flex size-11 shrink-0 items-center justify-center text-slate-400"
          >
            <X size={18} aria-hidden />
          </button>
        )}
      </li>
    )
  }

  // Every day gets a row, an empty one too (the user's rule): "פנוי", or what started earlier and goes on.
  const row = (day: AgendaDay) => (
    <li key={day.date} className="flex items-start gap-3">
      <span className="w-12 shrink-0 pt-0.5 text-center leading-tight">
        <span className="block text-xs text-slate-400">{when(day.date)}</span>
        <span className="block text-sm font-semibold text-slate-100">{showDate(day.date)}</span>
      </span>
      {day.items.length ? (
        <ul className="min-w-0 flex-1 space-y-2">{day.items.map(entry)}</ul>
      ) : day.going.length ? (
        <p className="min-w-0 flex-1 border-s-2 border-slate-700 ps-3 pt-1 text-sm text-slate-400">
          {tx('המשך: {v}', { v: day.going.map((i) => (i.type === 'job' ? agendaText(i, roles.items).title || tx('עבודה') : agendaText(i, roles.items).title)).join(', ') })}
        </p>
      ) : (
        <p className="min-w-0 flex-1 border-s-2 border-slate-700 ps-3 pt-1 text-sm text-slate-500">{tx('פנוי')}</p>
      )}
    </li>
  )

  return (
    // A tap anywhere on the box opens the month; the heading is the button for keyboard and screen readers.
    <section aria-label={tx('הלוח האישי')} onClick={onOpen} className="cursor-pointer space-y-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
      <h3>
        <button type="button" onClick={(e) => { e.stopPropagation(); onOpen() }} className="flex min-h-8 w-full items-center gap-2 text-start text-sm font-semibold text-slate-200">
          <CalendarDays size={16} aria-hidden className="text-sky-300" />
          {tx('הלוח האישי')}
          <span className="text-xs font-normal text-slate-400">{tx('3 הימים הקרובים')}</span>
          <span className="ms-auto flex items-center gap-0.5 text-xs font-normal text-sky-300">
            {tx('לוח חודשי')}
            <ChevronLeft size={14} aria-hidden />
          </span>
        </button>
      </h3>
      {loading ? (
        <p className="text-sm text-slate-400">{tx('טוען...')}</p>
      ) : (
        <ul className="space-y-3">{agendaDays(items, today).map(row)}</ul>
      )}
    </section>
  )
}
