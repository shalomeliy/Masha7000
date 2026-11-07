import { CalendarDays, ChevronLeft, X } from 'lucide-react'
import { dayNames, tx } from '../../i18n'
import { useDriveList } from '../../lib/data/useDriveList'
import { todayIso } from '../../lib/dates'
import { addDays, showDate, weekday } from '../../lib/shifts'
import { agendaText, workerAgenda, type AgendaItem } from '../../lib/workerAgenda'
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
  onOpen,
}: {
  items: AgendaItem[]
  loading: boolean
  onRemove: (constraintId: string) => void
  onOpen: () => void // the worker's month
}) {
  const defs = useDriveList('shiftDefinitions')
  const roles = useDriveList('roles')
  const today = todayIso()
  const when = (date: string) => (date === today ? tx('היום') : date === addDays(today, 1) ? tx('מחר') : SHORT_DAYS[weekday(date)])

  const row = (item: AgendaItem) => {
    const { title, detail } = agendaText(item, roles.items)
    const job = item.type === 'job'
    const sick = item.type === 'away' && item.sick
    const kind = job ? (item.shift.urgent ? tx('עבודה דחופה') : defs.items.find((d) => d.id === item.shift.shiftDefinitionId)?.name) : undefined
    const until = job && item.endDate !== item.date ? tx('עד {v}', { v: showDate(item.endDate) }) : ''
    return (
      <li key={item.key} className={`flex items-center gap-3 border-s-2 ps-3 ${job ? 'border-sky-400' : sick ? 'border-rose-400' : 'border-amber-400'}`}>
        <span className="w-12 shrink-0 text-center leading-tight">
          <span className="block text-xs text-slate-400">{when(item.date)}</span>
          <span className="block text-sm font-semibold text-slate-100">{showDate(item.date)}</span>
        </span>
        <span className="min-w-0 flex-1 text-sm leading-snug">
          <span className={`block ${job ? 'text-slate-100' : sick ? 'text-rose-200' : 'text-amber-200'}`}>{job ? title || tx('עבודה') : title}</span>
          {job && <span className="block text-xs text-slate-400">{[kind, detail, until].filter(Boolean).join(' · ')}</span>}
        </span>
        {/* Sickness from today is the worker's status, changed on the status line; any other absence goes here. */}
        {item.type === 'away' && item.key !== 'sick' && (
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
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-400">{tx('אין עבודות או היעדרויות ב-3 הימים הקרובים.')}</p>
      ) : (
        <ul className="space-y-2.5">{items.map(row)}</ul>
      )}
    </section>
  )
}
