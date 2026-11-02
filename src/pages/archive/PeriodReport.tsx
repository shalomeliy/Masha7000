import { ChevronLeft, ChevronRight, Download, MessageCircle } from 'lucide-react'
import { useDriveList } from '../../lib/data/useDriveList'
import { COLUMNS, addMonths, csvFileName, monthCsv, monthLabel, monthReport, monthText } from '../../lib/monthReport'
import type { PeriodReport as Counts } from '../../lib/monthReport'
import { whatsappHref } from '../../lib/report'
import { addDays, weekLabel, weekOf, weekReport, weekText } from '../../lib/weekReport'

// Every worker's shifts in one month or one week (Sunday to Saturday), by kind. Tap a worker to
// see those shifts in the list.

interface Props {
  today: string
  onWorker: (workerId: string) => void
}

export function MonthReport({ month, today, onMonth, onWorker }: Props & { month: string; onMonth: (m: string) => void }) {
  const shifts = useDriveList('shifts')
  const workers = useDriveList('workers')
  const defs = useDriveList('shiftDefinitions')
  const rep = monthReport(month, shifts.items, workers.items, defs.items, today)
  return (
    <PeriodReport
      rep={rep}
      label={monthLabel(month)}
      current={month === today.slice(0, 7)}
      inPeriod="בחודש"
      prevLabel="החודש הקודם"
      nextLabel="החודש הבא"
      onPrev={() => onMonth(addMonths(month, -1))}
      onNext={() => onMonth(addMonths(month, 1))}
      text={monthText(rep)}
      fileName={csvFileName(month)}
      onWorker={onWorker}
    />
  )
}

export function WeekReport({ week, today, onWeek, onWorker }: Props & { week: string; onWeek: (sunday: string) => void }) {
  const shifts = useDriveList('shifts')
  const workers = useDriveList('workers')
  const defs = useDriveList('shiftDefinitions')
  const rep = weekReport(week, shifts.items, workers.items, defs.items, today)
  return (
    <PeriodReport
      rep={rep}
      label={weekLabel(week)}
      current={week === weekOf(today)}
      inPeriod="בשבוע"
      prevLabel="השבוע הקודם"
      nextLabel="השבוע הבא"
      onPrev={() => onWeek(addDays(week, -7))}
      onNext={() => onWeek(addDays(week, 7))}
      text={weekText(rep)}
      fileName={csvFileName(week)}
      onWorker={onWorker}
    />
  )
}

function PeriodReport({
  rep,
  label,
  current,
  inPeriod,
  prevLabel,
  nextLabel,
  onPrev,
  onNext,
  text,
  fileName,
  onWorker,
}: {
  rep: Counts
  label: string
  current: boolean
  inPeriod: string
  prevLabel: string
  nextLabel: string
  onPrev: () => void
  onNext: () => void
  text: string
  fileName: string
  onWorker: (workerId: string) => void
}) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([monthCsv(rep)], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const num = 'px-2 py-2 text-center tabular-nums'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900 p-2">
        <button type="button" onClick={onPrev} aria-label={prevLabel} className="flex size-11 items-center justify-center rounded-xl text-slate-300">
          <ChevronRight size={22} aria-hidden />
        </button>
        <p className="text-center font-semibold">
          {label}
          {current && <span className="block text-xs font-normal text-slate-400">עד היום</span>}
        </p>
        <button
          type="button"
          onClick={onNext}
          disabled={current}
          aria-label={nextLabel}
          className="flex size-11 items-center justify-center rounded-xl text-slate-300 disabled:opacity-30"
        >
          <ChevronLeft size={22} aria-hidden />
        </button>
      </div>

      {rep.shifts === 0 ? (
        <p role="status" className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
          אין עבודות {inPeriod} הזה
        </p>
      ) : (
        <>
          <p role="status" className="text-sm text-slate-300">
            {rep.shifts === 1 ? 'עבודה אחת' : `${rep.shifts} עבודות`} {inPeriod}. דחופות וסופ"ש כבר נספרו ביום או בלילה. לחיצה על עובד מציגה את העבודות שלו.
          </p>
          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-400">
                <tr className="border-b border-slate-800">
                  <th scope="col" className="sticky start-0 bg-slate-900 px-3 py-2 text-start font-medium">
                    עובד
                  </th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} scope="col" className={`${num} font-medium ${c.key === 'total' ? 'text-slate-200' : ''}`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rep.rows.map((r) => (
                  <tr key={r.workerId} className={`border-b border-slate-800/60 ${r.total || r.swappedOut ? '' : 'text-slate-500'}`}>
                    <th scope="row" className="sticky start-0 bg-slate-900 p-0 text-start font-normal">
                      <button type="button" onClick={() => onWorker(r.workerId)} className="min-h-11 w-full whitespace-nowrap px-3 text-start text-sky-300 underline-offset-2 hover:underline">
                        {r.name}
                      </button>
                    </th>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className={`${num} ${c.key === 'total' ? 'font-semibold text-slate-100' : ''}`}>
                        {r[c.key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <th scope="row" className="sticky start-0 bg-slate-900 px-3 py-2 text-start">
                    סה"כ
                  </th>
                  {COLUMNS.map((c) => (
                    <td key={c.key} className={num}>
                      {rep.totals[c.key]}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex gap-2">
            <a
              href={whatsappHref(text)}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 font-semibold text-slate-950"
            >
              <MessageCircle size={18} aria-hidden />
              שליחה בוואטסאפ
            </a>
            <button type="button" onClick={download} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 text-sm text-slate-200">
              <Download size={18} aria-hidden />
              הורדה לאקסל
            </button>
          </div>
        </>
      )}
    </div>
  )
}
