import { useState } from 'react'
import { DateField } from '../../components/DateField'
import { Sheet, SheetActions } from '../../components/Sheet'
import { fullName, upsert } from '../../lib/catalog'
import { blockedCrew, constraintText } from '../../lib/constraints'
import { busyCrew, busyText } from '../../lib/planner'
import { useDriveList } from '../../lib/data/useDriveList'
import { addDays, dayName, isNightShift, moveShift, showDate, weekOf } from '../../lib/shifts'
import type { ShiftRecord } from '../../types/models'

// Move a whole shift, workers and all, to another day. The phone-friendly way; on a computer the
// card can also be dragged onto a day.

export function MoveSheet({ shift, onClose }: { shift: ShiftRecord | null; onClose: () => void }) {
  const shifts = useDriveList('shifts')
  return (
    <Sheet open={shift !== null} title="העברת משמרת ליום אחר" onClose={onClose} locked={shifts.saving}>
      {shift && <MoveForm key={shift.id} shift={shift} onDone={onClose} />}
    </Sheet>
  )
}

function MoveForm({ shift, onDone }: { shift: ShiftRecord; onDone: () => void }) {
  const shifts = useDriveList('shifts')
  const defs = useDriveList('shiftDefinitions')
  const workers = useDriveList('workers')
  const [date, setDate] = useState(shift.date)
  const [valid, setValid] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const moved = moveShift(shift, date)
  const blocked = valid && date !== shift.date ? blockedCrew(moved, workers.items, defs.items) : []
  // A worker cannot be in two shifts at the same time: that move is refused until they are swapped.
  const clashes = valid && date !== shift.date ? busyCrew(moved, workers.items, shifts.items, defs.items) : []
  // Quick picks: the shift's week and the week after it. Any other day goes through the date field.
  const days = [...weekOf(shift.date).days, ...weekOf(addDays(shift.date, 7)).days]

  const save = async () => {
    const err = !valid
      ? 'התאריך לא תקין'
      : date === shift.date
        ? 'בחר יום אחר מהיום של המשמרת'
        : clashes.length
          ? `${busyText(clashes)}. אי אפשר להעביר: קודם החלף ${clashes.length > 1 ? 'אותם' : 'אותו'} בעריכת המשמרת.`
          : null
    setError(err)
    if (err) return
    setBusy(true)
    setSaveError(null)
    try {
      await shifts.save(upsert(shifts.items, moved))
      onDone()
    } catch (e) {
      setSaveError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="text-sm text-slate-300">
        המשמרת עוברת עם כל העובדים שבה.
        {isNightShift(shift, defs.items) && ' משמרת לילה ממשיכה גם ביום שאחריו, כמו קודם.'}
      </p>
      <div className="flex flex-wrap gap-2">
        {days.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={date === d}
            onClick={() => (setDate(d), setValid(true))}
            className={`min-h-11 rounded-full border px-3 text-sm ${date === d ? 'border-sky-500 bg-sky-500/15 text-sky-300' : 'border-slate-700 text-slate-300'}`}
          >
            {dayName(d)} {showDate(d)}
            {d === shift.date && ' (עכשיו)'}
          </button>
        ))}
      </div>
      <DateField label="או תאריך אחר" value={date} required onChange={(d, ok) => (setDate(d), setValid(ok))} />
      {clashes.length > 0 && (
        <p role="status" className="rounded-xl border border-red-500/60 bg-red-500/10 p-3 text-sm text-red-200">
          {busyText(clashes)}. עובד לא יכול להיות בשתי משמרות באותו זמן.
        </p>
      )}
      {blocked.length > 0 && (
        <div role="status" className="space-y-1 rounded-xl border border-orange-500/60 bg-orange-500/10 p-3 text-sm text-orange-200">
          <p className="font-medium">ביום הזה יש לעובדים האלה אילוץ:</p>
          {blocked.map(({ worker, constraint }) => (
            <p key={worker.id}>
              {fullName(worker)}: {constraintText(constraint)}
              {constraint.note && ` (${constraint.note})`}
            </p>
          ))}
          <p className="text-orange-300">אפשר להעביר בכל זאת, ואז להחליף אותם בעריכת המשמרת.</p>
        </div>
      )}
      <SheetActions onSave={save} onCancel={onDone} saveLabel="העברה" busy={busy} error={error} saveError={saveError} />
    </>
  )
}
