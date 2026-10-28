import { useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, MessageCircle, Share2 } from 'lucide-react'
import { Sheet } from '../../components/Sheet'
import { requestText } from '../../lib/constraints'
import { todayIso } from '../../lib/dates'
import { whatsappHref } from '../../lib/report'
import { addDays, showDate, weekOf } from '../../lib/shifts'

// The constraints request the manager sends to the workers' group. Each worker fills in the
// days and sends it back; the reply is pasted into that worker's constraints.
export function RequestSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [weekStart, setWeekStart] = useState(() => addDays(weekOf(todayIso()).start, 7))
  const [copied, setCopied] = useState(false)
  const text = requestText(weekStart)

  const move = (days: number) => {
    setWeekStart(addDays(weekStart, days))
    setCopied(false)
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Sheet open={open} title="בקשת אילוצים מהעובדים" onClose={onClose}>
      <div className="flex items-center justify-between rounded-xl bg-slate-900 p-1">
        <button type="button" aria-label="שבוע קודם" onClick={() => move(-7)} className="flex size-11 items-center justify-center text-slate-300">
          <ChevronRight size={20} aria-hidden />
        </button>
        <span className="text-sm font-medium">
          שבוע {showDate(weekStart)} עד {showDate(addDays(weekStart, 6))}
        </span>
        <button type="button" aria-label="שבוע הבא" onClick={() => move(7)} className="flex size-11 items-center justify-center text-slate-300">
          <ChevronLeft size={20} aria-hidden />
        </button>
      </div>
      <pre className="max-h-[40dvh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950 p-3 font-sans text-sm text-slate-200">{text}</pre>
      <p className="text-xs text-slate-400">כשעובד עונה, פתח את העובד, לחץ "הדבקת תשובה מוואטסאפ" והדבק את ההודעה שלו.</p>
      <a
        href={whatsappHref(text)}
        target="_blank"
        rel="noreferrer"
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 font-semibold text-slate-950"
      >
        <MessageCircle size={20} aria-hidden />
        שליחה בוואטסאפ
      </a>
      <div className="flex gap-2">
        {'share' in navigator && (
          <button
            type="button"
            onClick={() => navigator.share({ text }).catch(() => {})}
            className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 text-sm text-slate-200"
          >
            <Share2 size={18} aria-hidden />
            שיתוף
          </button>
        )}
        <button type="button" onClick={copy} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 text-sm text-slate-200">
          <Copy size={18} aria-hidden />
          {copied ? 'הועתק' : 'העתקה'}
        </button>
      </div>
      <button type="button" onClick={onClose} className="min-h-12 w-full rounded-xl border border-slate-700 text-slate-300">
        סגירה
      </button>
    </Sheet>
  )
}
