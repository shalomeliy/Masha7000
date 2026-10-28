import { useState } from 'react'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { ensureShiftsCalendar, deleteEvent, listEvents, upsertEvent } from '../lib/google/calendar'
import { readJson, writeJson } from '../lib/google/drive'
import { TIME_ZONE } from '../lib/google/config'
import { useAuth } from '../store/auth'

type StepState = 'idle' | 'running' | 'ok' | 'fail'
interface Step {
  label: string
  state: StepState
  detail?: string
}

const STEP_LABELS = [
  'כתיבת קובץ בדיקה לגוגל דרייב',
  'קריאת הקובץ חזרה מגוגל דרייב',
  'מציאת או יצירת היומן Smart Shifts',
  'יצירת אירוע בדיקה ביומן',
  'קריאת האירוע ומחיקתו',
]

// Connection check: proves the whole Google round trip (Drive appData + Calendar) from the browser.
async function runCheck(update: (i: number, s: StepState, detail?: string) => void) {
  const steps: (() => Promise<string | void>)[] = [
    () => writeJson('connection_check.json', { at: new Date().toISOString() }),
    async () => {
      const data = await readJson<{ at: string }>('connection_check.json')
      if (!data?.at) throw new Error('הקובץ לא נמצא')
    },
    async () => {
      calendarId = await ensureShiftsCalendar()
    },
    async () => {
      const start = new Date(Date.now() + 60 * 60 * 1000)
      const end = new Date(start.getTime() + 30 * 60 * 1000)
      const ev = await upsertEvent(calendarId, {
        summary: 'בדיקת חיבור ShiftSmart',
        description: JSON.stringify({ check: true }),
        start: { dateTime: start.toISOString(), timeZone: TIME_ZONE },
        end: { dateTime: end.toISOString(), timeZone: TIME_ZONE },
      })
      eventId = ev.id!
      checkStart = start
    },
    async () => {
      const found = await listEvents(calendarId, new Date(checkStart.getTime() - 1000), new Date(checkStart.getTime() + 3600_000))
      if (!found.some((e) => e.id === eventId)) throw new Error('האירוע לא נמצא ביומן')
      await deleteEvent(calendarId, eventId)
    },
  ]
  let calendarId = ''
  let eventId = ''
  let checkStart = new Date()
  for (let i = 0; i < steps.length; i++) {
    update(i, 'running')
    try {
      await steps[i]()
      update(i, 'ok')
    } catch (e) {
      update(i, 'fail', (e as Error).message)
      return
    }
  }
}

export function Settings() {
  const logout = useAuth((s) => s.logout)
  const [steps, setSteps] = useState<Step[]>(STEP_LABELS.map((label) => ({ label, state: 'idle' })))
  const running = steps.some((s) => s.state === 'running')

  const start = () => {
    setSteps(STEP_LABELS.map((label) => ({ label, state: 'idle' })))
    runCheck((i, state, detail) =>
      setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, state, detail } : s))),
    )
  }

  return (
    <section className="space-y-6 px-4 pt-6">
      <h1 className="text-2xl font-bold">הגדרות</h1>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-semibold">בדיקת חיבור לגוגל</h2>
        <p className="mt-1 text-sm text-slate-400">בודקת שהאפליקציה יכולה לשמור בדרייב ולכתוב ליומן. אירוע הבדיקה נמחק בסוף.</p>
        <ol className="mt-4 space-y-2">
          {steps.map((s) => (
            <li key={s.label} className="flex items-start gap-2 text-sm">
              {s.state === 'ok' && <CheckCircle2 className="shrink-0 text-emerald-400" size={18} aria-label="הצליח" />}
              {s.state === 'fail' && <XCircle className="shrink-0 text-red-400" size={18} aria-label="נכשל" />}
              {s.state === 'running' && <Loader2 className="shrink-0 animate-spin text-sky-400" size={18} aria-label="רץ" />}
              {s.state === 'idle' && <span className="inline-block size-[18px] shrink-0 rounded-full border border-slate-600" />}
              <span>
                {s.label}
                {s.detail && <span className="block break-all text-red-300">{s.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={start}
          disabled={running}
          className="mt-4 w-full rounded-xl bg-sky-500 py-3 font-semibold text-slate-950 disabled:opacity-50"
        >
          {running ? 'בודק...' : 'הרץ בדיקה'}
        </button>
      </div>

      <button type="button" onClick={logout} className="w-full rounded-xl border border-slate-700 py-3 text-slate-300">
        התנתקות
      </button>
    </section>
  )
}
