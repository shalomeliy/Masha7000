import { useState } from 'react'
import { ChevronLeft, ChevronRight, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { DriveError } from '../components/DriveError'
import { groupWords, GROUPS } from '../lib/constraintWords'
import { useDriveList } from '../lib/data/useDriveList'
import { ensureShiftsCalendar, deleteEvent, listEvents, upsertEvent } from '../lib/google/calendar'
import { readJson, writeJson } from '../lib/google/drive'
import { TIME_ZONE } from '../lib/google/config'
import { useAuth } from '../store/auth'
import { NameListSection } from './settings/NameListSection'
import { WordsSection } from './settings/WordsSection'
import { ReasonsSection } from './ToSchedule'
import { ShiftsSection } from './workers/ShiftsSection'
import { TagSection } from './workers/TagSection'

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

// Every list the manager can change, in one place. Each one is also where it is used (roles in
// "עובדים", postpone reasons in "לשיבוץ"); this screen opens the same editors.
type ListId = 'roles' | 'certifications' | 'shiftDefinitions' | 'postponeReasons' | 'places' | 'jobTypes' | 'constraintWords'

const LISTS: { id: ListId; title: string; explain: string }[] = [
  {
    id: 'roles',
    title: 'תפקידים',
    explain: 'טפסן, חשמלאי... מה כל עובד יודע לעשות',
  },
  {
    id: 'certifications',
    title: 'הסמכות',
    explain: 'אישורים שיש לעובדים, למשל עבודה בגובה',
  },
  {
    id: 'shiftDefinitions',
    title: 'סוגי משמרות',
    explain: 'יום, לילה, כוננות',
  },
  {
    id: 'postponeReasons',
    title: 'סיבות דחייה',
    explain: 'למה עבודת לילה נדחתה',
  },
  {
    id: 'places',
    title: 'מקומות',
    explain: 'מקומות עבודה שחוזרים, לבחירה מהירה',
  },
  {
    id: 'jobTypes',
    title: 'סוגי עבודה',
    explain: 'עבודות שחוזרות, לבחירה מהירה',
  },
  {
    id: 'constraintWords',
    title: 'מילים לקריאת אילוצים',
    explain: 'איך מבינים תשובה מוואטסאפ',
  },
]

export function Settings() {
  const logout = useAuth((s) => s.logout)
  const [open, setOpen] = useState<ListId | null>(null)
  // The editors read each other's lists (names, usage counts), so they load together.
  const lists = {
    roles: useDriveList('roles'),
    certifications: useDriveList('certifications'),
    shiftDefinitions: useDriveList('shiftDefinitions'),
    postponeReasons: useDriveList('postponeReasons'),
    places: useDriveList('places'),
    jobTypes: useDriveList('jobTypes'),
    constraintWords: useDriveList('constraintWords'),
    workers: useDriveList('workers'),
    shifts: useDriveList('shifts'),
    pendingJobs: useDriveList('pendingJobs'),
  }
  const all = Object.values(lists)
  const loading = all.some((l) => l.query.isPending)
  const failed = all.find((l) => l.query.isError)
  const count = (id: ListId) =>
    id === 'constraintWords'
      ? GROUPS.reduce(
          (n, g) =>
            n +
            groupWords(
              g.id,
              lists.constraintWords.items.find((s) => s.id === g.id),
            ).length,
          0,
        )
      : lists[id].items.length
  const current = LISTS.find((l) => l.id === open)

  if (current)
    return (
      <section className="space-y-4 px-4 pt-6">
        <button type="button" onClick={() => setOpen(null)} className="flex min-h-11 items-center gap-1 text-sky-300">
          <ChevronRight size={20} aria-hidden />
          הגדרות
        </button>
        <h1 className="text-2xl font-bold">{current.title}</h1>
        {current.id === 'roles' && <TagSection kind="roles" />}
        {current.id === 'certifications' && <TagSection kind="certifications" />}
        {current.id === 'shiftDefinitions' && <ShiftsSection />}
        {current.id === 'postponeReasons' && <ReasonsSection />}
        {current.id === 'places' && <NameListSection kind="places" />}
        {current.id === 'jobTypes' && <NameListSection kind="jobTypes" />}
        {current.id === 'constraintWords' && <WordsSection />}
      </section>
    )

  return (
    <section className="space-y-6 px-4 pt-6">
      <h1 className="text-2xl font-bold">הגדרות</h1>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">רשימות</h2>
        {failed ? (
          <DriveError error={failed.query.error} action="load" onRetry={() => all.forEach((l) => l.query.isError && l.query.refetch())} />
        ) : loading ? (
          <p className="flex items-center gap-2 text-slate-400">
            <Loader2 className="animate-spin" size={18} aria-hidden />
            טוען מגוגל דרייב...
          </p>
        ) : (
          <ul className="divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
            {LISTS.map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => setOpen(l.id)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start">
                  <span className="flex-1">
                    <span className="block font-semibold">{l.title}</span>
                    <span className="block text-xs text-slate-400">{l.explain}</span>
                  </span>
                  <span className="shrink-0 text-sm text-slate-400">{count(l.id)}</span>
                  <ChevronLeft size={18} aria-hidden className="shrink-0 text-slate-500" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConnectionCheck />

      <button type="button" onClick={logout} className="w-full rounded-xl border border-slate-700 py-3 text-slate-300">
        התנתקות
      </button>
    </section>
  )
}

function ConnectionCheck() {
  const [steps, setSteps] = useState<Step[]>(STEP_LABELS.map((label) => ({ label, state: 'idle' })))
  const running = steps.some((s) => s.state === 'running')

  const start = () => {
    setSteps(STEP_LABELS.map((label) => ({ label, state: 'idle' })))
    runCheck((i, state, detail) => setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, state, detail } : s))))
  }

  return (
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
  )
}
