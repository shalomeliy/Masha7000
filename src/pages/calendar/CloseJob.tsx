import { useState } from 'react'
import { DictationField } from '../../components/DictationField'
import { Chips, Field, inputClass, Sheet, SheetActions } from '../../components/Sheet'
import { useDriveList } from '../../lib/data/useDriveList'
import { applyClosure, closureError } from '../../lib/shifts'
import type { ClosureOutcome, ShiftRecord } from '../../types/models'
import { OUTCOMES } from './outcomes'

// Closing a night job: done, partial, or postponed (reasons and/or a note).
// Partial either reopens the same task, or closes it and opens a linked follow-up task with what is left.
// Postponed and partial both leave a task in "לשיבוץ".

type PartialMode = 'reopen' | 'followUp'

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
  const prior = shift.closure?.outcome === 'partial' ? shift.closure : undefined
  const [mode, setMode] = useState<PartialMode | null>(prior ? (prior.followUp ? 'followUp' : 'reopen') : null)
  const [followUp, setFollowUp] = useState(prior?.followUp ?? { location: shift.location, jobDescription: '' })
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
    if (outcome === 'partial' && !mode) return setError('צריך לבחור מה קורה עם מה שנשאר')
    const closure = {
      outcome,
      note: outcome === 'done' ? undefined : note.trim() || undefined,
      reasonIds: outcome === 'postponed' ? reasonIds : [],
      followUp:
        outcome === 'partial' && mode === 'followUp'
          ? { location: followUp.location.trim(), jobDescription: followUp.jobDescription.trim() }
          : undefined,
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
      {outcome === 'partial' && (
        <>
          <DictationField label="מה בוצע (לא חובה)" value={note} onChange={setNote} />
          <div role="radiogroup" aria-label="מה קורה עם מה שנשאר" className="space-y-2">
            <span className="text-sm text-slate-300">מה קורה עם מה שנשאר?</span>
            {(
              [
                ['reopen', 'לפתוח מחדש את אותה משימה', 'המשימה חוזרת ללשונית "לשיבוץ" כמו שהיא.'],
                ['followUp', 'לסגור ולפתוח משימת המשך', 'המשימה הזו נסגרת. אתה כותב מה נשאר, וזו משימה חדשה שמקושרת אליה.'],
              ] as const
            ).map(([id, title, explain]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={mode === id}
                onClick={() => setMode(id)}
                className={`block w-full rounded-xl border p-3 text-start ${mode === id ? 'border-sky-500 bg-sky-500/10' : 'border-slate-700'}`}
              >
                <span className="block font-semibold">{title}</span>
                <span className="block text-sm text-slate-400">{explain}</span>
              </button>
            ))}
          </div>
          {mode === 'followUp' && (
            <div className="space-y-3 rounded-xl border border-sky-500/40 p-3">
              <span className="block font-semibold text-sky-300">משימת ההמשך</span>
              <Field label="מיקום">
                <input value={followUp.location} onChange={(e) => setFollowUp((f) => ({ ...f, location: e.target.value }))} className={inputClass} />
              </Field>
              <DictationField label="מה נשאר לעשות" value={followUp.jobDescription} onChange={(v) => setFollowUp((f) => ({ ...f, jobDescription: v }))} />
            </div>
          )}
        </>
      )}
      {outcome === 'postponed' && <DictationField label="פרטים נוספים (לא חובה אם בחרת סיבה)" value={note} onChange={setNote} />}
      {outcome && outcome !== 'done' && <p className="text-sm text-slate-400">העבודה תופיע בלשונית "לשיבוץ" עד שתשבץ אותה למשמרת.</p>}

      <SheetActions
        onSave={save}
        onCancel={onDone}
        onDelete={shift.closure ? () => write(undefined) : undefined}
        deleteWarning="לבטל את הסגירה? העבודה תחזור להיות פתוחה, כאילו לא נסגרה."
        deleteLabel="ביטול הסגירה"
        confirmLabel="כן, לבטל"
        busy={busy}
        error={error}
        saveError={saveError}
      />
    </>
  )
}
