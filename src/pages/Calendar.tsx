import { useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Plus, Zap } from 'lucide-react'
import { DriveError } from '../components/DriveError'
import { fullName, tagNames } from '../lib/catalog'
import { useDriveList } from '../lib/data/useDriveList'
import { todayIso } from '../lib/dates'
import { addDays, blankShift, dayName, isNightShift, showDate, sortShifts, urgentShift, weekOf } from '../lib/shifts'
import type { ShiftRecord } from '../types/models'
import { CloseSheet } from './calendar/CloseJob'
import { OUTCOMES } from './calendar/outcomes'
import { ShiftSheet } from './calendar/ShiftEditor'
import { EditMark } from './workers/common'

// The week, Sunday to Saturday, with every shift in it. Urgent shifts can be opened any moment.

export function Calendar() {
  const shifts = useDriveList('shifts')
  const defs = useDriveList('shiftDefinitions')
  // The cards and sheets read these too (names, roles, reasons), so everything loads together.
  const lists = [shifts, defs, useDriveList('workers'), useDriveList('roles'), useDriveList('pendingJobs'), useDriveList('postponeReasons')]
  const loading = lists.some((l) => l.query.isPending)
  const failed = lists.find((l) => l.query.isError)
  const today = todayIso()
  const [weekStart, setWeekStart] = useState(() => weekOf(today).start)
  const [editing, setEditing] = useState<ShiftRecord | null>(null)
  const [closing, setClosing] = useState<ShiftRecord | null>(null)
  const week = weekOf(weekStart)
  const records = sortShifts(shifts.items)

  return (
    <section className="space-y-4 px-4 pt-6">
      <h1 className="text-2xl font-bold">יומן משמרות</h1>

      {failed ? (
        <DriveError error={failed.query.error} action="load" onRetry={() => lists.forEach((l) => l.query.isError && l.query.refetch())} />
      ) : loading ? (
        <p className="flex items-center gap-2 text-slate-400">
          <Loader2 className="animate-spin" size={18} aria-hidden />
          טוען מגוגל דרייב...
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setEditing(urgentShift(new Date(), defs.items))}
              className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-amber-500 font-semibold text-slate-950"
            >
              <Zap size={20} aria-hidden />
              משמרת דחופה עכשיו
            </button>
            <button
              type="button"
              onClick={() => setEditing(blankShift(week.days.includes(today) ? today : week.start))}
              className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-slate-700 font-semibold text-slate-200"
            >
              <Plus size={20} aria-hidden />
              משמרת חדשה
            </button>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-slate-900 p-1">
            <button type="button" aria-label="השבוע הקודם" onClick={() => setWeekStart(addDays(week.start, -7))} className="flex size-11 items-center justify-center text-slate-300">
              <ChevronRight size={22} aria-hidden />
            </button>
            <button type="button" onClick={() => setWeekStart(weekOf(today).start)} className="min-h-11 px-3 text-sm">
              {week.days.includes(today) ? 'השבוע' : 'שבוע'} {showDate(week.start)} - {showDate(week.end)}
            </button>
            <button type="button" aria-label="השבוע הבא" onClick={() => setWeekStart(addDays(week.start, 7))} className="flex size-11 items-center justify-center text-slate-300">
              <ChevronLeft size={22} aria-hidden />
            </button>
          </div>

          <ol className="space-y-4">
            {week.days.map((day) => {
              const dayShifts = records.filter((r) => r.date === day)
              return (
                <li key={day} className="space-y-2">
                  <h2 className={`text-sm font-semibold ${day === today ? 'text-sky-400' : 'text-slate-400'}`}>
                    יום {dayName(day)} {showDate(day)}
                    {day === today && ' · היום'}
                  </h2>
                  {dayShifts.length === 0 ? (
                    <p className="text-sm text-slate-600">אין משמרות</p>
                  ) : (
                    <ul className="space-y-2">
                      {dayShifts.map((r) => (
                        <li key={r.id}>
                          <ShiftCard shift={r} canClose={r.date <= today} onOpen={() => setEditing(r)} onCloseJob={() => setClosing(r)} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ol>
        </>
      )}

      <ShiftSheet editing={editing} onClose={() => setEditing(null)} />
      <CloseSheet shift={closing} onClose={() => setClosing(null)} />
    </section>
  )
}

// A night job can be closed once it has started (and changed later, whenever it is closed).
function ShiftCard({ shift: r, canClose, onOpen, onCloseJob }: { shift: ShiftRecord; canClose: boolean; onOpen: () => void; onCloseJob: () => void }) {
  const defs = useDriveList('shiftDefinitions')
  const workers = useDriveList('workers')
  const roles = useDriveList('roles')
  const reasons = useDriveList('postponeReasons')
  const def = defs.items.find((d) => d.id === r.shiftDefinitionId)
  const night = isNightShift(r, defs.items)
  const outcome = OUTCOMES.find((o) => o.id === r.closure?.outcome)
  const reasonText = r.closure ? tagNames(r.closure.reasonIds, reasons.items).join(', ') : ''

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
      <button type="button" onClick={onOpen} className="relative w-full space-y-2 p-4 pe-9 text-start">
        <EditMark />
        <span className="flex flex-wrap items-center gap-2 text-xs">
          {r.urgent && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-semibold text-amber-300">דחופה מ-{r.startTime}</span>}
          {def && <span className="rounded-full bg-slate-800 px-2 py-0.5 text-slate-300">{def.name}</span>}
          {r.fromJobId && <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-sky-300">המשך של משימה קודמת</span>}
          {r.urgent && r.endDate && (
            <span className="text-slate-400">
              עד יום {dayName(r.endDate)} {r.endTime}
            </span>
          )}
        </span>
        {r.location && <span className="block font-semibold">{r.location}</span>}
        {r.jobDescription && <span className="block text-sm text-slate-300">{r.jobDescription}</span>}
        {r.crew.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {r.crew.map((c) => {
              const w = workers.items.find((x) => x.id === c.workerId)
              const role = roles.items.find((x) => x.id === c.roleId)
              return (
                <span key={c.workerId} className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-200">
                  {w ? fullName(w) : 'עובד שנמחק'}
                  {role && ` · ${role.name}`}
                </span>
              )
            })}
          </span>
        ) : (
          <span className="block text-xs text-amber-300">עוד אין עובדים במשמרת</span>
        )}
      </button>
      {night && (canClose || r.closure) && (
        <button type="button" onClick={onCloseJob} className="flex min-h-12 w-full items-center gap-2 border-t border-slate-800 px-4 text-start text-sm">
          {outcome ? (
            <>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${outcome.tone}`}>{outcome.label}</span>
              <span className="min-w-0 truncate text-slate-400">{[reasonText, r.closure?.note].filter(Boolean).join(' · ')}</span>
            </>
          ) : (
            <span className="font-semibold text-sky-400">סגירת עבודה</span>
          )}
        </button>
      )}
    </div>
  )
}
