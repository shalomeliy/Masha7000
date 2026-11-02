import { busyText } from '../../lib/planner'
import type { ShiftRecord, Worker } from '../../types/models'

// Asked before a worker busy in another job at the same time is put into this one: on yes, they
// leave that job.
export function PullConfirm({ pulls, onYes, onNo }: { pulls: { worker: Worker; other: ShiftRecord }[]; onYes: () => void; onNo: () => void }) {
  const many = pulls.length > 1
  return (
    <div role="alertdialog" aria-label="העברת עובד מעבודה אחרת" className="space-y-2 rounded-xl border-2 border-orange-500 bg-orange-500/10 p-3 text-sm text-orange-100">
      <p className="font-semibold">{busyText(pulls)}.</p>
      <p>
        אם תמשיך, {many ? 'הם יוסרו מהעבודות ההן ויעברו' : 'הוא יוסר מהעבודה ההיא ויעבור'} לעבודה הזו. העבודה ההיא תישאר עם מקום ריק. בטוח?
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onYes} className="min-h-11 rounded-xl bg-orange-500 font-semibold text-slate-950">
          כן, להעביר
        </button>
        <button type="button" onClick={onNo} className="min-h-11 rounded-xl border border-slate-600 font-semibold text-slate-200">
          לא
        </button>
      </div>
    </div>
  )
}
