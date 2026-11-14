import { useState } from 'react'
import { CalendarArrowUp, Check, ChevronLeft, ChevronRight, Loader2, MessageCircle, Plus, Wand2, Zap } from 'lucide-react'
import { DriveError } from '../components/DriveError'
import { fullName, tagNames, upsert } from '../lib/catalog'
import { blockedCrew, constraintText } from '../lib/constraints'
import { useDriveList } from '../lib/data/useDriveList'
import { todayIso } from '../lib/dates'
import { busyCrew, busyText } from '../lib/planner'
import { gapCounts, placeText, shiftGaps, type GapKind, type ShiftGaps } from '../lib/gaps'
import { dayData, nextJobText, weekData } from '../lib/report'
import type { Report } from '../lib/report'
import { addDays, blankShift, dayName, weekday, isNightShift, moveShift, showDate, sortShifts, urgentShift, weekOf } from '../lib/shifts'
import type { ShiftRecord } from '../types/models'
import { CloseSheet } from './calendar/CloseJob'
import { MoveSheet } from './calendar/MoveSheet'
import { OUTCOMES } from './calendar/outcomes'
import { ShareSheet } from './calendar/ShareSheet'
import { ShiftSheet } from './calendar/ShiftEditor'
import { WeekPlanSheet } from './calendar/WeekPlanSheet'
import { EditMark, WorkerDial } from './workers/common'
import { WaitingJobs } from './ToSchedule'
import { jobVehicleText } from '../lib/vehicles'
import { dayNames, tx } from '../i18n'

const SHORT_DAYS = dayNames('short')

// The week, Sunday to Saturday, with every shift in it. Urgent shifts can be opened any moment.

export function Calendar() {
  const shifts = useDriveList('shifts')
  const defs = useDriveList('shiftDefinitions')
  // The cards and sheets read these too (names, certifications, reasons), so everything loads together.
  const workers = useDriveList('workers')
  const certs = useDriveList('certifications')
  const lists = [shifts, defs, workers, certs, useDriveList('pendingJobs'), useDriveList('postponeReasons'), useDriveList('vehicles')]
  const loading = lists.some((l) => l.query.isPending)
  const failed = lists.find((l) => l.query.isError)
  const today = todayIso()
  const [weekStart, setWeekStart] = useState(() => weekOf(today).start)
  const [editing, setEditing] = useState<ShiftRecord | null>(null)
  const [closing, setClosing] = useState<ShiftRecord | null>(null)
  const [sharing, setSharing] = useState<{ title: string; report: Report; warning?: string } | null>(null)
  const [moving, setMoving] = useState<ShiftRecord | null>(null)
  // Dragging a card onto another day (mouse; on a phone the card's "העברה ליום אחר" does it).
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropDay, setDropDay] = useState<string | null>(null)
  const [dropError, setDropError] = useState<unknown>(null)
  const [dropRefused, setDropRefused] = useState<string | null>(null)
  const [filter, setFilter] = useState<GapKind | null>(null)
  const [planning, setPlanning] = useState<ShiftRecord[] | null>(null)
  const week = weekOf(weekStart)
  const records = sortShifts(shifts.items)
  const ctx = { shifts: shifts.items, defs: defs.items, workers: workers.items }
  // What each shift of the week still needs (docs/specs/week-gaps.md). Computed, never saved.
  const gapCtx = {
    workers: workers.items,
    records: shifts.items,
    defs: defs.items,
    certifications: certs.items,
  }
  const weekShifts = records.filter((r) => r.date >= week.start && r.date <= week.end)
  const gaps = new Map(weekShifts.map((r) => [r.id, shiftGaps(r, gapCtx)]))
  const counts = gapCounts([...gaps.values()])
  const shown = (r: ShiftRecord) => !filter || !!gaps.get(r.id)?.kinds.includes(filter)
  // "שבץ את השבוע": open shifts from today on that still have an empty place.
  const toPlan = weekShifts.filter((r) => !r.closure && r.date >= today && gaps.get(r.id)?.missing.length)
  const changeWeek = (start: string) => (setWeekStart(start), setFilter(null))

  const drop = async (day: string) => {
    const r = shifts.items.find((x) => x.id === dragId)
    setDragId(null)
    setDropDay(null)
    if (!r || r.date === day) return
    setDropError(null)
    setDropRefused(null)
    if (day < today) return setDropRefused(tx('אי אפשר להעביר עבודה ליום שכבר עבר.'))
    const moved = moveShift(r, day)
    const busy = busyCrew(moved, workers.items, shifts.items, defs.items)
    if (busy.length) return setDropRefused(tx('{v}. אי אפשר להעביר את העבודה ליום הזה לפני שמחליפים {v2}.', { v: busyText(busy), v2: busy.length > 1 ? tx('אותם') : tx('אותו') }))
    try {
      await shifts.save(upsert(shifts.items, moved))
    } catch (e) {
      setDropError(e)
    }
  }

  return (
    <section className="space-y-4 px-4 pt-6">
      <h1 className="text-2xl font-bold">{tx('יומן עבודות')}</h1>

      {failed ? (
        <DriveError error={failed.query.error} action="load" onRetry={() => lists.forEach((l) => l.query.isError && l.query.refetch())} />
      ) : loading ? (
        <p className="flex items-center gap-2 text-slate-400">
          <Loader2 className="animate-spin" size={18} aria-hidden />
          {tx('טוען מגוגל דרייב...')}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              data-hint="urgentNow"
              onClick={() => setEditing(urgentShift(new Date(), defs.items))}
              className="flex min-h-14 min-w-0 items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-2 text-center leading-tight font-semibold text-slate-950 max-[379px]:text-[15px]"
            >
              <Zap size={20} aria-hidden className="shrink-0" />
              {tx('עבודה דחופה עכשיו')}
            </button>
            <button
              type="button"
              data-hint="newJob"
              onClick={() => setEditing(blankShift(week.days.includes(today) ? today : week.start))}
              className="flex min-h-14 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-slate-700 px-2 text-center leading-tight font-semibold text-slate-200 max-[379px]:text-[15px]"
            >
              <Plus size={20} aria-hidden className="shrink-0" />
              {tx('עבודה חדשה')}
            </button>
          </div>

          {/* Jobs still waiting for a day (until 2026-11-13 the "לשיבוץ" tab). */}
          <WaitingJobs />

          <div className="flex items-center justify-between rounded-xl bg-slate-900 p-1">
            <button type="button" aria-label={tx('השבוע הקודם')} onClick={() => changeWeek(addDays(week.start, -7))} className="flex size-11 items-center justify-center text-slate-300">
              <ChevronRight size={22} aria-hidden />
            </button>
            <button type="button" onClick={() => changeWeek(weekOf(today).start)} className="min-h-11 px-3 text-sm">
              {week.days.includes(today) ? tx('השבוע') : tx('שבוע')} {showDate(week.start)} - {showDate(week.end)}
            </button>
            <button type="button" aria-label={tx('השבוע הבא')} onClick={() => changeWeek(addDays(week.start, 7))} className="flex size-11 items-center justify-center text-slate-300">
              <ChevronLeft size={22} aria-hidden />
            </button>
          </div>

          <button
            type="button"
            data-hint="shareWeek"
            onClick={() =>
              setSharing({
                title: tx('סידור השבוע לוואטסאפ'),
                report: weekData(week.start, ctx),
                warning: counts.missing ? tx('שים לב: {v} עובדים.', { v: counts.missing === 1 ? tx('עבודה אחת עוד חסרה') : tx('{missing} עבודות עוד חסרות', { missing: counts.missing }) }) : undefined,
              })
            }
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/50 text-sm font-semibold text-emerald-300"
          >
            <MessageCircle size={18} aria-hidden />
            {tx('שליחת סידור השבוע בוואטסאפ')}
          </button>

          {weekShifts.length > 0 && (
            <button
              type="button"
              disabled={toPlan.length === 0}
              onClick={() => setPlanning(toPlan)}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-sky-500 text-sm font-semibold text-slate-950 disabled:bg-slate-800 disabled:text-slate-400"
            >
              <Wand2 size={18} aria-hidden />
              {toPlan.length ? tx('שבץ את השבוע ({v})', { v: toPlan.length === 1 ? tx('עבודה אחת') : tx('{length} עבודות', { length: toPlan.length }) }) : tx('אין עבודות פתוחות לשבץ')}
            </button>
          )}

          {weekShifts.length > 0 && <WeekStatus counts={counts} filter={filter} onFilter={setFilter} />}

          {dropError != null && <DriveError error={dropError} action="save" />}
          {dropRefused && (
            <p role="alert" className="rounded-xl border border-red-500/60 bg-red-500/10 p-3 text-sm text-red-200">
              {dropRefused}
            </p>
          )}

          {/* One tap jumps to a day's first shift; it stays on top while scrolling, so the next jump is one tap too. */}
          <nav aria-label={tx('קפיצה ליום')} className="sticky top-0 z-10 -mx-4 grid grid-cols-7 gap-1 bg-slate-950 px-4 py-2">
            {week.days.map((day) => {
              const hidden = filter && !records.some((r) => r.date === day && shown(r))
              return (
                <button
                  key={day}
                  type="button"
                  disabled={!!hidden}
                  onClick={() => document.getElementById(`day-${day}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  aria-label={tx('יום {weekday} {v2}', { weekday: dayName(day), v2: showDate(day) })}
                  className={`flex min-h-11 flex-col items-center justify-center rounded-lg text-xs disabled:opacity-30 ${
                    day === today ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-900 text-slate-300'
                  }`}
                >
                  <span className="font-semibold">{SHORT_DAYS[weekday(day)]}</span>
                  <span>{Number(day.slice(8))}</span>
                </button>
              )
            })}
          </nav>

          <ol className="space-y-4">
            {week.days.map((day) => {
              const all = records.filter((r) => r.date === day)
              const dayShifts = all.filter(shown)
              const missingToday = all.filter((r) => gaps.get(r.id)?.kinds.includes('missing')).length
              if (filter && dayShifts.length === 0) return null
              return (
                <li
                  key={day}
                  id={`day-${day}`}
                  onDragOver={(e) => {
                    if (!dragId) return
                    e.preventDefault()
                    setDropDay(day)
                  }}
                  onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropDay((d) => (d === day ? null : d))}
                  onDrop={(e) => (e.preventDefault(), drop(day))}
                  className={`scroll-mt-20 space-y-2 rounded-xl ${dropDay === day ? 'outline-2 outline-offset-4 outline-dashed outline-sky-500' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h2 className={`text-sm font-semibold ${day === today ? 'text-sky-400' : 'text-slate-400'}`}>
                      {tx('יום {weekday}', { weekday: dayName(day) })} {showDate(day)}
                      {day === today && tx(' · היום')}
                      {missingToday > 0 && (
                        <span className="ms-2 inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white">
                          <span className="sr-only">{tx('חסרים עובדים ב-')}</span>
                          {missingToday}
                          <span className="sr-only"> {missingToday === 1 ? tx('עבודה') : tx('עבודות')}</span>
                        </span>
                      )}
                    </h2>
                    {all.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSharing({ title: tx('יום {weekday} {v2} לוואטסאפ', { weekday: dayName(day), v2: showDate(day) }), report: dayData(day, ctx) })}
                        className="flex min-h-11 items-center gap-1.5 px-2 text-xs text-emerald-300"
                      >
                        <MessageCircle size={16} aria-hidden />
                        {tx('שליחת היום')}
                      </button>
                    )}
                  </div>
                  {dayShifts.length === 0 ? (
                    <p className="text-sm text-slate-600">{tx('אין עבודות')}</p>
                  ) : (
                    <ul className="space-y-2">
                      {dayShifts.map((r) => (
                        <li key={r.id}>
                          <ShiftCard
                            shift={r}
                            gaps={gaps.get(r.id)!}
                            canClose={r.date <= today}
                            onOpen={() => setEditing(r)}
                            onCloseJob={() => setClosing(r)}
                            onMove={() => setMoving(r)}
                            onDragStart={() => setDragId(r.id)}
                            onDragEnd={() => (setDragId(null), setDropDay(null))}
                          />
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
      <MoveSheet shift={moving} onClose={() => setMoving(null)} />
      <WeekPlanSheet shifts={planning} onClose={() => setPlanning(null)} />
      <ShareSheet title={sharing?.title ?? ''} report={sharing?.report ?? null} warning={sharing?.warning} onClose={() => setSharing(null)} />
    </section>
  )
}

// A night job can be closed once it has started (and changed later, whenever it is closed).
// A closed job already happened, so it is not moved.
function ShiftCard({
  shift: r,
  gaps,
  canClose,
  onOpen,
  onCloseJob,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  shift: ShiftRecord
  gaps: ShiftGaps
  canClose: boolean
  onOpen: () => void
  onCloseJob: () => void
  onMove: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const defs = useDriveList('shiftDefinitions')
  const workers = useDriveList('workers')
  const certs = useDriveList('certifications')
  const reasons = useDriveList('postponeReasons')
  const vehicles = useDriveList('vehicles')
  const def = defs.items.find((d) => d.id === r.shiftDefinitionId)
  const night = isNightShift(r, defs.items)
  const outcome = OUTCOMES.find((o) => o.id === r.closure?.outcome)
  const reasonText = r.closure ? tagNames(r.closure.reasonIds, reasons.items).join(', ') : ''
  // A constraint added after the crew was picked, or a shift moved onto a worker's day off:
  // the shift and that worker are outlined in orange, so the manager opens it and swaps them.
  const blocked = r.closure ? [] : blockedCrew(r, workers.items, defs.items)
  const blockedIds = new Set(blocked.map((b) => b.worker.id))
  const missing = gaps.missing.length > 0
  const warnIds = new Set([...gaps.doubleIds, ...gaps.nightIds])
  const warnOf = (id: string) =>
    [gaps.doubleIds.includes(id) && tx('כבר בעבודה אחרת באותו זמן'), gaps.nightIds.includes(id) && tx('מעל 2 לילות השבוע')].filter(Boolean).join(', ')
  const showClose = night && (canClose || !!r.closure)

  return (
    <div
      draggable={!r.closure}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', r.id)
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      className={`overflow-hidden rounded-2xl border bg-slate-900 ${missing ? 'border-2 border-red-500' : blocked.length ? 'border-2 border-orange-500' : 'border-slate-800'}`}
    >
      <button type="button" onClick={onOpen} className="relative w-full space-y-2 p-4 pe-9 text-start">
        <EditMark />
        <span className="flex flex-wrap items-center gap-2 text-xs">
          {!r.closure && gaps.kinds.length === 0 && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-300">
              <Check size={12} aria-hidden />
              {tx('מאויש')}
            </span>
          )}
          {r.urgent && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-semibold text-amber-300">{tx('דחופה מ-{startTime}', { startTime: r.startTime })}</span>}
          {def && <span className="rounded-full bg-slate-800 px-2 py-0.5 text-slate-300">{def.name}</span>}
          {r.fromJobId && <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-sky-300">{tx('המשך של משימה קודמת')}</span>}
          {r.urgent && r.endDate && (
            <span className="text-slate-400">
              {tx('עד יום {weekday} {endTime}', { weekday: dayName(r.endDate), endTime: r.endTime })}</span>
          )}
        </span>
        {r.location && <span className="block font-semibold">{r.location}</span>}
        {r.jobDescription && <span className="block whitespace-pre-line text-sm text-slate-300">{r.jobDescription}</span>}
        {(r.vehicleId || r.vehicleModel) && <span className="block text-sm text-slate-400">{tx('רכב: {v}', { v: jobVehicleText(r, vehicles.items) })}</span>}
        {nextJobText(r) && <span className="block text-sm text-violet-300">{tx('אחרי הלילה: {v}', { v: nextJobText(r) })}</span>}
        {missing && (
          <span className="block space-y-0.5 text-xs text-red-300">
            {gaps.missing.map((m, i) => (
              <span key={i} className="block">
                <span className="font-semibold">{tx('חסר: {v}', { v: placeText(m.slot, certs.items) })}</span>
                {m.why && <span className="text-red-300/80"> · {m.why}</span>}
              </span>
            ))}
          </span>
        )}
        {warnIds.size > 0 && (
          <span className="block space-y-0.5 text-xs text-amber-300">
            {[...warnIds].map((id) => {
              const w = workers.items.find((x) => x.id === id)
              return (
                <span key={id} className="block">
                  {w ? fullName(w) : ''}: {warnOf(id)}
                </span>
              )
            })}
          </span>
        )}
        {blocked.length > 0 && (
          <span className="block space-y-0.5 text-xs text-orange-300">
            {blocked.map(({ worker, constraint }) => (
              <span key={worker.id} className="block">
                {fullName(worker)}: {constraintText(constraint)}
                {constraint.note && ` (${constraint.note})`}
              </span>
            ))}
            <span className="block text-orange-400">{tx('לחץ על העבודה כדי להחליף {v}', { v: blocked.length > 1 ? tx('אותם') : tx('אותו') })}</span>
          </span>
        )}
      </button>
      {/* Outside the edit button: tapping a worker dials them instead of opening the editor. */}
      {r.crew.length > 0 && (
        <div className="-mt-2 flex flex-wrap gap-1.5 px-4 pb-4">
          {r.crew.map((c) => {
            return (
              <WorkerDial
                key={c.workerId}
                worker={workers.items.find((x) => x.id === c.workerId)}
                className={`min-h-9 rounded-full px-3 py-1.5 text-xs ${
                  blockedIds.has(c.workerId) ? 'border-2 border-orange-500 bg-orange-500/10 text-orange-200' : 'bg-slate-800 text-slate-200'
                }`}
              />
            )
          })}
        </div>
      )}
      {(showClose || !r.closure) && (
        <div className="flex border-t border-slate-800">
          {!r.closure && (
            <button
              type="button"
              onClick={onMove}
              className={`flex min-h-12 items-center gap-1.5 px-4 text-sm text-slate-300 ${showClose ? '' : 'flex-1'}`}
            >
              <CalendarArrowUp size={16} aria-hidden />
              {tx('העברה ליום אחר')}
            </button>
          )}
          {showClose && (
            <button type="button" onClick={onCloseJob} className={`flex min-h-12 min-w-0 flex-1 items-center gap-2 px-4 text-sm ${r.closure ? 'text-start' : 'justify-end border-s border-slate-800 text-end'}`}>
              {outcome ? (
                <>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${outcome.tone}`}>{outcome.label}</span>
                  <span className="min-w-0 truncate text-slate-400">{[reasonText, r.closure?.note].filter(Boolean).join(' · ')}</span>
                </>
              ) : (
                <span className="font-semibold text-sky-400">{tx('סגירת עבודה')}</span>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const STATUS: { kind: GapKind; label: string; tone: string }[] = [
  { kind: 'missing', label: tx('חסרים עובדים'), tone: 'border-red-500/60 bg-red-500/15 text-red-200' },
  { kind: 'blocked', label: tx('התנגשות אילוץ'), tone: 'border-orange-500/60 bg-orange-500/15 text-orange-200' },
  { kind: 'double', label: tx('אותו עובד פעמיים'), tone: 'border-amber-500/60 bg-amber-500/10 text-amber-200' },
  { kind: 'nights', label: tx('מעל 2 לילות'), tone: 'border-amber-500/60 bg-amber-500/10 text-amber-200' },
]

// The week at a glance: how many shifts still need something; a tap shows only those.
function WeekStatus({ counts, filter, onFilter }: { counts: Record<GapKind, number>; filter: GapKind | null; onFilter: (k: GapKind | null) => void }) {
  const chips = STATUS.filter((s) => counts[s.kind] > 0)
  if (chips.length === 0)
    return (
      <p role="status" className="flex min-h-11 items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 text-sm font-semibold text-emerald-300">
        <Check size={18} aria-hidden />
        {tx('כל העבודות השבוע מאוישות')}
      </p>
    )
  return (
    <div role="group" aria-label={tx('מצב השבוע')} className="flex flex-wrap gap-2">
      {chips.map((s) => (
        <button
          key={s.kind}
          type="button"
          aria-pressed={filter === s.kind}
          onClick={() => onFilter(filter === s.kind ? null : s.kind)}
          className={`flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm ${s.tone} ${filter === s.kind ? 'ring-2 ring-white/70' : ''}`}
        >
          <span className="font-bold">{counts[s.kind]}</span>
          {s.label}
        </button>
      ))}
      {filter && (
        <button type="button" onClick={() => onFilter(null)} className="min-h-11 rounded-full border border-slate-700 px-3 text-sm text-slate-300">
          {tx('הצג הכול')}
        </button>
      )}
    </div>
  )
}
