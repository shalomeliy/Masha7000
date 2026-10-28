import { useState } from 'react'
import { DictationField } from '../../components/DictationField'
import { Chips, Sheet, SheetActions } from '../../components/Sheet'
import { useDriveList } from '../../lib/data/useDriveList'
import { applyClosure, closureError } from '../../lib/shifts'
import type { ClosureOutcome, ShiftRecord } from '../../types/models'
import { OUTCOMES } from './outcomes'

// Closing a night job: done, partial (what is left), or postponed (reasons and/or a note).
// Partial and postponed leave the job in "לשיבוץ".

export function CloseSheet({ shift, onClose }: { shift: ShiftRecord | null; onClose: () => void }) {
  const shifts = useDriveList('shifts')
  const pending = useDriveList('pendingJobs')
  return (
    <Sheet open={shift !== null} title="סגירת עבודה" onClose={onClose} locked={shifts.saving || pending.saving}>
      {shift && <CloseForm shift={shift} onDone={onClose} />}
    </Sheet>
  )
}

function CloseForm({ shift, onDone }: { shift: ShiftRecord; onDone: () => void }) {
  const shifts = useDriveList('shifts')
  const pending = useDriveList('pendingJobs')
  const reasons = useDriveList('postponeReasons')
  const [outcome, setOutcome] = useState<ClosureOutcome | null>(shift.closure?.outcome ?? null)
  const [note, setNote] = useState(shift.closure?.note ?? '')
  const [reasonIds, setReasonIds] = useState(shift.closure?.reasonIds ?? [])
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const write = async (closure: Parameters<typeof applyClosure>[3]) => {
    const next = applyClosure(shifts.items, pending.items, shift.id, closure)
    let shiftSaved = false
    setBusy(true)
    setSaveError(null)
    try {
      // The shift first: a retry re-applies the same closure, and the waiting job is matched by shift.
      await shifts.save(next.records)
      shiftSaved = true
      if (next.pending !== pending.items) await pending.save(next.pending)
      onDone()
    } catch (e) {
      if (shiftSaved) setError('הסגירה נשמרה, אבל רשימת "לשיבוץ" עוד לא עודכנה. לחץ שוב על הכפתור כדי להשלים.')
      setSaveError(e)
    } finally {
      setBusy(false)
    }
  }

  const save = () => {
    if (!outcome) return setError('צריך לבחור איך העבודה הסתיימה')
    const closure = {
      outcome,
      note: outcome === 'done' ? undefined : note.trim() || undefined,
      reasonIds: outcome === 'postponed' ? reasonIds : [],
      closedAt: new Date().toISOString(),
    }
    const err = closureError(closure)
    setError(err)
    if (!err) write(closure)
  }

  return (
    <>
      <p className="text-sm text-slate-400">
        {[shift.location, shift.jobDescription].filter(Boolean).join(' · ')}
      </p>
      <div role="radiogroup" aria-label="איך העבודה הסתיימה" className="grid grid-cols-3 gap-2">
        {OUTCOMES.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={outcome === o.id}
            onClick={() => setOutcome(o.id)}
            className={`min-h-14 rounded-xl border px-2 text-sm font-semibold ${outcome === o.id ? o.tone : 'border-slate-700 text-slate-300'}`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {outcome === 'postponed' && (
        <div className="space-y-1">
          <span className="text-sm text-slate-300">סיבת הדחייה</span>
          {reasons.items.length ? (
            <Chips options={reasons.items} selected={reasonIds} onToggle={(id) => setReasonIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))} />
          ) : (
            <p className="text-sm text-amber-300">עוד אין רשימת סיבות. אפשר להוסיף אותה בלשונית "לשיבוץ", או לכתוב את הסיבה כאן למטה.</p>
          )}
        </div>
      )}
      {outcome === 'partial' && <DictationField label="מה בוצע ומה נשאר לעשות" value={note} onChange={setNote} />}
      {outcome === 'postponed' && <DictationField label="פרטים נוספים (לא חובה אם בחרת סיבה)" value={note} onChange={setNote} />}
      {outcome && outcome !== 'done' && <p className="text-sm text-slate-400">העבודה תופיע בלשונית "לשיבוץ" עד שתשבץ אותה למשמרת.</p>}

      <SheetActions
        onSave={save}
        onCancel={onDone}
        onDelete={shift.closure ? () => write(undefined) : undefined}
        deleteWarning="לבטל את הסגירה? העבודה תחזור להיות פתוחה."
        deleteLabel="פתיחה מחדש"
        confirmLabel="כן, לפתוח"
        busy={busy}
        error={error}
        saveError={saveError}
      />
    </>
  )
}
