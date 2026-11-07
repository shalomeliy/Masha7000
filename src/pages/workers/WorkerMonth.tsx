import { useState } from 'react'
import { ChevronLeft, ChevronRight, Pencil, X } from 'lucide-react'
import { Sheet } from '../../components/Sheet'
import { dayNames, monthNames, tx } from '../../i18n'
import { fullName } from '../../lib/catalog'
import { constraintText } from '../../lib/constraints'
import { useDriveList } from '../../lib/data/useDriveList'
import { todayIso } from '../../lib/dates'
import { DAY_NAMES, showDate, weekday } from '../../lib/shifts'
import { workerMonth, type DayEntry } from '../../lib/workerAgenda'
import type { Worker } from '../../types/models'

// The worker's whole month, opened from the personal calendar in their card: a month grid with a
// colored dot per thing on each day, and below it every day with its jobs, sickness and absences.

const MONTHS = monthNames()
const SHORT_DAYS = dayNames('short')

// A dot's color: a job, sickness, each kind of absence, and an ordinary constraint.
const TONE = {
  job: { dot: 'bg-sky-400', line: 'border-sky-400', text: 'text-slate-100' },
  sick: { dot: 'bg-rose-400', line: 'border-rose-400', text: 'text-rose-200' },
  vacation: { dot: 'bg-teal-300', line: 'border-teal-300', text: 'text-teal-200' },
  study: { dot: 'bg-violet-400', line: 'border-violet-400', text: 'text-violet-200' },
  reserve: { dot: 'bg-lime-400', line: 'border-lime-400', text: 'text-lime-200' },
  course: { dot: 'bg-orange-400', line: 'border-orange-400', text: 'text-orange-200' },
  other: { dot: 'bg-amber-300', line: 'border-amber-300', text: 'text-amber-200' },
} as const
type Tone = keyof typeof TONE

const LEGEND: { tone: Tone; name: string }[] = [
  { tone: 'job', name: tx('עבודה') },
  { tone: 'sick', name: tx('מחלה') },
  { tone: 'vacation', name: tx('חופש') },
  { tone: 'study', name: tx('לימודים') },
  { tone: 'reserve', name: tx('מילואים') },
  { tone: 'course', name: tx('השתלמות או קורס') },
  { tone: 'other', name: tx('לא זמין') },
]

const toneOf = (e: DayEntry): Tone =>
  e.type === 'job' ? 'job' : e.sick ? 'sick' : e.constraint.kind && e.constraint.kind !== 'sick' ? e.constraint.kind : 'other'

const moveMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number)
  const n = y * 12 + (m - 1) + by
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`
}

export function WorkerMonth({
  worker,
  open,
  onClose,
  onRemove,
  onEditSick,
  onEdit,
}: {
  worker: Worker
  open: boolean
  onClose: () => void
  onRemove: (constraintId: string) => void // a dated constraint, removed from the card (saved with "שמירה"); 'sick' ends the status sickness
  onEditSick: () => void // the status sheet, to change the sickness's last day
  onEdit: (constraintId: string) => void // any other dated absence: its editor in the card
}) {
  const shifts = useDriveList('shifts')
  const defs = useDriveList('shiftDefinitions')
  const roles = useDriveList('roles')
  const today = todayIso()
  const [month, setMonth] = useState(today.slice(0, 7))
  const days = workerMonth(worker, shifts.items, defs.items, month, today)
  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1).getDay()
  const count = new Date(y, m, 0).getDate()
  const cells = [...Array<null>(first).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)]
  const all = [...days.values()].flat()
  const jobs = new Set(all.filter((e) => e.type === 'job').map((e) => e.key)).size
  const away = [...days.values()].filter((list) => list.some((e) => e.type === 'away')).length
  const dayId = (day: string) => `worker-day-${day}`

  const entry = (e: DayEntry, day: string) => {
    const tone = TONE[toneOf(e)]
    if (e.type === 'away') {
      const note = e.constraint.note?.trim()
      return (
        <li key={e.key} className={`flex items-center gap-1 border-s-2 ps-2 ${tone.line}`}>
          <span className="min-w-0 flex-1">
            <span className={`block ${tone.text}`}>{constraintText(e.constraint)}</span>
            {note && note !== 'מחלה' && <span className="block truncate text-xs text-slate-400">{note}</span>}
          </span>
          {/* Dated ones and sickness are changed here (not in the card's list); weekly ones in the list. */}
          {(e.key === 'sick' || e.constraint.when === 'dates') && (
            <button
              type="button"
              aria-label={e.key === 'sick' ? tx('עריכת המחלה') : tx('עריכת האילוץ: {v}', { v: constraintText(e.constraint) })}
              onClick={() => (e.key === 'sick' ? onEditSick() : onEdit(e.constraint.id))}
              className="flex size-11 shrink-0 items-center justify-center text-slate-400"
            >
              <Pencil size={16} aria-hidden />
            </button>
          )}
          {e.constraint.when === 'dates' && (
            <button
              type="button"
              aria-label={tx('מחיקת האילוץ: {v}', { v: constraintText(e.constraint) })}
              onClick={() => onRemove(e.constraint.id)}
              className="flex size-11 shrink-0 items-center justify-center text-slate-400"
            >
              <X size={18} aria-hidden />
            </button>
          )}
        </li>
      )
    }
    const s = e.shift
    const kind = s.urgent ? tx('עבודה דחופה') : defs.items.find((d) => d.id === s.shiftDefinitionId)?.name
    const role = roles.items.find((r) => r.id === e.roleId)?.name
    // A night job shows on both its days; the second day says it is the same job going on.
    const more = day !== s.date ? tx('המשך מ-{v}', { v: showDate(s.date) }) : e.endDate !== s.date ? tx('עד {v}', { v: showDate(e.endDate) }) : ''
    return (
      <li key={e.key} className={`border-s-2 ps-2 ${tone.line}`}>
        <span className="block text-slate-100">{[s.location, s.jobDescription].filter(Boolean).join(' · ') || tx('עבודה')}</span>
        <span className="block text-xs text-slate-400">{[kind, role, more].filter(Boolean).join(' · ')}</span>
      </li>
    )
  }

  return (
    <Sheet open={open} title={tx('הלוח החודשי של {v}', { v: fullName(worker) })} onClose={onClose}>
      <div className="rounded-2xl border border-slate-700 p-2">
        <div className="mb-2 flex items-center justify-between">
          <button type="button" aria-label={tx('החודש הקודם')} onClick={() => setMonth(moveMonth(month, -1))} className="flex size-11 items-center justify-center text-slate-300">
            <ChevronRight size={20} aria-hidden />
          </button>
          <span className="font-semibold">{`${MONTHS[m - 1]} ${y}`}</span>
          <button type="button" aria-label={tx('החודש הבא')} onClick={() => setMonth(moveMonth(month, 1))} className="flex size-11 items-center justify-center text-slate-300">
            <ChevronLeft size={20} aria-hidden />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-400">
          {SHORT_DAYS.map((d, i) => (
            <abbr key={d + i} title={DAY_NAMES[i]} className="no-underline">
              {d}
            </abbr>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (!d) return <span key={`e${i}`} />
            const day = `${month}-${String(d).padStart(2, '0')}`
            const list = days.get(day) ?? []
            const tones = [...new Set(list.map(toneOf))].slice(0, 3)
            return (
              <button
                key={day}
                type="button"
                disabled={!list.length}
                aria-label={tx('{d} ב{v}', { d, v: MONTHS[m - 1] })}
                // A tap on a day with something on it scrolls to that day in the list below.
                onClick={() => document.getElementById(dayId(day))?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                className={`flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg text-sm ${day === today ? 'ring-1 ring-sky-400' : ''} ${list.length ? 'bg-slate-800/70 text-slate-100' : 'text-slate-500'}`}
              >
                {d}
                <span className="flex h-1.5 gap-0.5">
                  {tones.map((t) => (
                    <span key={t} className={`size-1.5 rounded-full ${TONE[t].dot}`} />
                  ))}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400" aria-label={tx('מקרא')}>
        {LEGEND.map((l) => (
          <li key={l.tone} className="flex items-center gap-1">
            <span className={`size-2 rounded-full ${TONE[l.tone].dot}`} aria-hidden />
            {l.name}
          </li>
        ))}
      </ul>

      <p className="text-sm text-slate-300">{tx('בחודש הזה: {jobs} עבודות, {away} ימים לא זמין', { jobs, away })}</p>

      {shifts.query.isPending ? (
        <p className="text-sm text-slate-400">{tx('טוען...')}</p>
      ) : days.size === 0 ? (
        <p className="text-sm text-slate-400">{tx('אין עבודות או היעדרויות בחודש הזה.')}</p>
      ) : (
        <ol className="space-y-3">
          {[...days].map(([day, list]) => (
            <li key={day} id={dayId(day)} className={`flex gap-3 rounded-xl p-2 ${day === today ? 'bg-sky-500/10' : ''} ${day < today ? 'opacity-60' : ''}`}>
              <span className="w-12 shrink-0 text-center leading-tight">
                <span className="block text-xs text-slate-400">{day === today ? tx('היום') : SHORT_DAYS[weekday(day)]}</span>
                <span className="block text-sm font-semibold text-slate-100">{showDate(day)}</span>
              </span>
              <ul className="min-w-0 flex-1 space-y-1.5 text-sm leading-snug">{list.map((e) => entry(e, day))}</ul>
            </li>
          ))}
        </ol>
      )}
    </Sheet>
  )
}
