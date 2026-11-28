import { lazy, Suspense, useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { ChoiceList } from '../../components/ChoiceList'
import { Sheet } from '../../components/Sheet'
import { useSaveSettings, useSettings } from '../../lib/data/useFeatures'
import { dailyReport, DEFAULT_REPORT_HOUR, REPORT_HOURS, reportDue, type ReportItem } from '../../lib/dailyReport'
import type { GapContext } from '../../lib/gaps'
import type { ShiftRecord, Worker } from '../../types/models'
import { tx } from '../../i18n'

// "דוח יומי" on the calendar (the owner's request, 2026-11-28): the jobs of the next two days that
// still have a problem, and missing data. Computed here, free. From the chosen hour (settings.json,
// default 18:00) the button turns orange while something is open, until opened that day.

// The worker's form loads only when a worker line is tapped, so the calendar stays light.
const WorkerSheet = lazy(() => import('../workers/WorkersSection').then((m) => ({ default: m.WorkerSheet })))

const SEEN_KEY = 'dailyReport.seen'
const seenOn = (): string | null => {
  try {
    return localStorage.getItem(SEEN_KEY)
  } catch {
    return null
  }
}
const markSeen = (today: string) => {
  try {
    localStorage.setItem(SEEN_KEY, today)
  } catch {
    // private mode: the button stays orange until the report is clean
  }
}

export function DailyReport({ ctx, today, onOpenShift }: { ctx: GapContext; today: string; onOpenShift: (r: ShiftRecord) => void }) {
  const settings = useSettings()
  const save = useSaveSettings()
  const hour = settings.data?.dailyReportHour ?? DEFAULT_REPORT_HOUR
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(seenOn)
  const [worker, setWorker] = useState<Worker | null>(null)
  const items = dailyReport(ctx, today)
  const alert = items.length > 0 && reportDue(new Date(), hour) && seen !== today
  const show = () => {
    setOpen(true)
    markSeen(today)
    setSeen(today)
  }
  const pick = (i: ReportItem) => {
    const r = i.shiftId && ctx.records.find((x) => x.id === i.shiftId)
    const w = i.workerId && ctx.workers.find((x) => x.id === i.workerId)
    setOpen(false)
    if (r) onOpenShift(r)
    else if (w) setWorker(w)
  }
  const group = (g: ReportItem['group'], title: string) => {
    const list = items.filter((i) => i.group === g)
    if (!list.length) return null
    return (
      <div className="space-y-2">
        <h3 className={`text-sm font-semibold ${g === 'urgent' ? 'text-red-300' : 'text-amber-300'}`}>{title}</h3>
        <ul className="space-y-2">
          {list.map((i) => (
            <li key={i.key}>
              <button type="button" onClick={() => pick(i)} className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-start text-sm leading-snug text-slate-100 active:bg-slate-800">
                {i.text}
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={show}
        className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border text-sm font-semibold ${alert ? 'border-amber-500 bg-amber-500/15 text-amber-200' : 'border-slate-700 text-slate-300'}`}
      >
        <ClipboardList size={18} aria-hidden />
        {items.length ? tx('דוח יומי ({n} לטיפול)', { n: items.length }) : tx('דוח יומי: הכל מסודר')}
      </button>
      <Sheet open={open} title={tx('דוח יומי')} onClose={() => setOpen(false)}>
        <div className="space-y-4">
          {items.length === 0 && <p className="text-sm text-emerald-300">{tx('אין חוסרים ואין בעיות למחר ולמחרתיים.')}</p>}
          {group('urgent', tx('דחוף: מחר ומחרתיים'))}
          {group('data', tx('פרטים חסרים'))}
          <ChoiceList
            label={tx('שעת הדוח')}
            value={hour}
            options={REPORT_HOURS.map((h) => ({ value: h, label: h }))}
            onChange={(v) => save.mutate({ dailyReportHour: v })}
          />
          <p className="text-xs text-slate-400">{tx('מהשעה הזו הכפתור ביומן נצבע כתום כשיש מה לטפל. אפשר גם לשאול את Shali "מה בדוח היומי".')}</p>
        </div>
      </Sheet>
      {worker && (
        <Suspense fallback={null}>
          <WorkerSheet editing={worker} onClose={() => setWorker(null)} />
        </Suspense>
      )}
    </>
  )
}
