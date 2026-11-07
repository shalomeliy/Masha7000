import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DAY_NAMES } from '../lib/shifts'
import { dayNames, monthNames, tx } from '../i18n'

// A month calendar for picking any set of days (a tap marks or unmarks a day). Days before `min`
// cannot be picked. Weeks run Sunday to Saturday, right to left.

const MONTHS = monthNames()
const SHORT_DAYS = dayNames('short')
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

export function MonthDays({ selected, onToggle, min }: { selected: string[]; onToggle: (day: string) => void; min: string }) {
  const [year, setYear] = useState(Number(min.slice(0, 4)))
  const [month, setMonth] = useState(Number(min.slice(5, 7)) - 1)
  const move = (by: number) => {
    const m = month + by
    setYear(year + Math.floor(m / 12))
    setMonth(((m % 12) + 12) % 12)
  }
  const first = new Date(year, month, 1).getDay()
  const days = new Date(year, month + 1, 0).getDate()
  const cells = [...Array<null>(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  const atStart = iso(year, month, 1) <= min

  return (
    <div className="rounded-2xl border border-slate-700 p-2">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" aria-label={tx('החודש הקודם')} disabled={atStart} onClick={() => move(-1)} className="flex size-11 items-center justify-center text-slate-300 disabled:opacity-30">
          <ChevronRight size={20} aria-hidden />
        </button>
        <span className="font-semibold">{`${MONTHS[month]} ${year}`}</span>
        <button type="button" aria-label={tx('החודש הבא')} onClick={() => move(1)} className="flex size-11 items-center justify-center text-slate-300">
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
          const day = iso(year, month, d)
          const on = selected.includes(day)
          const past = day < min
          return (
            <button
              key={day}
              type="button"
              disabled={past}
              aria-pressed={on}
              aria-label={tx('{d} ב{v}', { d, v: MONTHS[month] })}
              onClick={() => onToggle(day)}
              className={`min-h-10 rounded-lg text-sm ${on ? 'bg-sky-600 font-semibold text-white' : 'text-slate-200'} disabled:opacity-30`}
            >
              {d}
            </button>
          )
        })}
      </div>
    </div>
  )
}
