import { useState } from 'react'
import { inputClass } from '../../components/Sheet'
import { fullName } from '../../lib/catalog'
import { useDriveList } from '../../lib/data/useDriveList'
import { fillInsFor } from '../../lib/moveAdvice'
import { busyText } from '../../lib/planner'
import { dayName, showDate } from '../../lib/shifts'
import type { ShiftRecord, Worker } from '../../types/models'
import { tx } from '../../i18n'

// Asked before a worker busy in another job at the same time is put into this one: on yes, they
// leave that job, and the manager picks who takes their place there so it is not left short.
// `exclude` are the workers already in the job they move into.
export function PullConfirm({
  pulls,
  exclude,
  onYes,
  onNo,
}: {
  pulls: { worker: Worker; other: ShiftRecord }[]
  exclude: string[]
  onYes: (fillIns: Record<string, string>) => void
  onNo: () => void
}) {
  const workers = useDriveList('workers')
  const shifts = useDriveList('shifts')
  const defs = useDriveList('shiftDefinitions')
  const certs = useDriveList('certifications')
  const [step, setStep] = useState<'sure' | 'fill'>('sure')
  const ctx = {
    workers: workers.items,
    records: shifts.items,
    defs: defs.items,
    certifications: certs.items,
  }
  const busy = [...exclude, ...pulls.map((p) => p.worker.id)]
  const options = pulls.map((p) => fillInsFor(p.other, p.worker.id, ctx, busy))
  // The fairest free worker is picked to start with; the manager can change it or leave the place empty.
  const [fillIns, setFillIns] = useState<Record<string, string>>(() =>
    Object.fromEntries(pulls.flatMap((p, i) => (options[i][0] ? [[p.worker.id, options[i][0].id]] : []))),
  )
  const many = pulls.length > 1
  const box = 'space-y-2 rounded-xl border-2 border-orange-500 bg-orange-500/10 p-3 text-sm text-orange-100'
  const yes = 'min-h-11 rounded-xl bg-orange-500 font-semibold text-slate-950'
  const no = 'min-h-11 rounded-xl border border-slate-600 font-semibold text-slate-200'

  if (step === 'sure')
    return (
      <div role="alertdialog" aria-label={tx('העברת עובד מעבודה אחרת')} className={box}>
        <p className="font-semibold">{busyText(pulls)}.</p>
        <p>{tx('אם תמשיך, {v} לעבודה הזו. בטוח?', { v: many ? tx('הם יוסרו מהעבודות ההן ויעברו') : tx('הוא יוסר מהעבודה ההיא ויעבור') })}</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setStep('fill')} className={yes}>
            {tx('כן, להעביר')}
          </button>
          <button type="button" onClick={onNo} className={no}>
            {tx('לא')}
          </button>
        </div>
      </div>
    )

  return (
    <div role="alertdialog" aria-label={tx('מי ייכנס במקומו')} className={box}>
      {pulls.map((p, i) => (
        <label key={p.worker.id} className="block space-y-1">
          <span className="block font-semibold">
            {tx('מי ייכנס במקום {v} בעבודה ביום {weekday} {v3}{v4}?', { v: fullName(p.worker), weekday: dayName(p.other.date), v3: showDate(p.other.date), v4: p.other.location && ` (${p.other.location})` })}</span>
          {options[i].length ? (
            <select
              value={fillIns[p.worker.id] ?? ''}
              onChange={(e) => setFillIns((f) => ({ ...f, [p.worker.id]: e.target.value }))}
              className={`${inputClass} text-slate-200`}
            >
              {options[i]
                .filter((w) => w.id === fillIns[p.worker.id] || !Object.values(fillIns).includes(w.id))
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {fullName(w)}
                  </option>
                ))}
              <option value="">{tx('להשאיר את המקום ריק')}</option>
            </select>
          ) : (
            <span className="block text-orange-200">{tx('אין עובד פנוי עם ההסמכות של המקום הזה. המקום שם יישאר ריק.')}</span>
          )}
        </label>
      ))}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => onYes(Object.fromEntries(Object.entries(fillIns).filter(([, v]) => v)))} className={yes}>
          {tx('אישור')}
        </button>
        <button type="button" onClick={onNo} className={no}>
          {tx('ביטול')}
        </button>
      </div>
    </div>
  )
}
