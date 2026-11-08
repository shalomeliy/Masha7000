import { tx } from '../i18n'
import { LanguagePicker } from './settings/LanguagePicker'
import { useEffect, useState } from 'react'
import { Archive as ArchiveIcon, ChevronLeft, ChevronRight, CheckCircle2, ClipboardList, ExternalLink, HardDrive, Lightbulb, Mic, Loader2, Scale, ShieldCheck, UserCircle, Users, XCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { holdBack } from '../components/backStack'
import { DriveError } from '../components/DriveError'
import { groupWords, GROUPS } from '../lib/constraintWords'
import { useDriveList } from '../lib/data/useDriveList'
import { ensureShiftsCalendar, deleteEvent, listEvents, upsertEvent } from '../lib/google/calendar'
import { readJson, writeJson } from '../lib/google/drive'
import { TIME_ZONE } from '../lib/google/config'
import { authMode } from '../lib/google/auth'
import { useAuth } from '../store/auth'
import { Archive } from './Archive'
import { AccessSection } from './settings/AccessSection'
import { BackupSection } from './settings/BackupSection'
import { SecuritySection } from './settings/SecuritySection'
import { FeatureRequestSection } from './settings/FeatureRequestSection'
import { ClaudeLogSection } from './settings/ClaudeLogSection'
import { DepartmentsSection } from './settings/DepartmentsSection'
import { NameListSection } from './settings/NameListSection'
import { WordsSection } from './settings/WordsSection'
import { PronunciationSection } from './settings/PronunciationSection'
import { ReasonsSection } from './ToSchedule'
import { ShiftsSection } from './workers/ShiftsSection'
import { TagSection } from './workers/TagSection'
import { WorkKindsSection } from './settings/WorkKindsSection'

type StepState = 'idle' | 'running' | 'ok' | 'fail'
interface Step {
  label: string
  state: StepState
  detail?: string
}

const STEP_LABELS = [
  tx('כתיבת קובץ בדיקה לגוגל דרייב'),
  tx('קריאת הקובץ חזרה מגוגל דרייב'),
  tx('מציאת או יצירת היומן Smart Shifts'),
  tx('יצירת אירוע בדיקה ביומן'),
  tx('קריאת האירוע ומחיקתו'),
]

// Connection check: proves the whole Google round trip (Drive appData + Calendar) from the browser.
async function runCheck(update: (i: number, s: StepState, detail?: string) => void) {
  const steps: (() => Promise<string | void>)[] = [
    () => writeJson('connection_check.json', { at: new Date().toISOString() }),
    async () => {
      const data = await readJson<{ at: string }>('connection_check.json')
      if (!data?.at) throw new Error(tx('הקובץ לא נמצא'))
    },
    async () => {
      calendarId = await ensureShiftsCalendar()
    },
    async () => {
      const start = new Date(Date.now() + 60 * 60 * 1000)
      const end = new Date(start.getTime() + 30 * 60 * 1000)
      const ev = await upsertEvent(calendarId, {
        summary: tx('בדיקת חיבור Shaly'),
        description: JSON.stringify({ check: true }),
        start: { dateTime: start.toISOString(), timeZone: TIME_ZONE },
        end: { dateTime: end.toISOString(), timeZone: TIME_ZONE },
      })
      eventId = ev.id!
      checkStart = start
    },
    async () => {
      const found = await listEvents(calendarId, new Date(checkStart.getTime() - 1000), new Date(checkStart.getTime() + 3600_000))
      if (!found.some((e) => e.id === eventId)) throw new Error(tx('האירוע לא נמצא ביומן'))
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

// Every list the manager can change, in one place. Each one is also where it is used (certifications in
// "עובדים", postpone reasons in "לשיבוץ"); this screen opens the same editors.
type ListId = 'certifications' | 'shiftDefinitions' | 'workKinds' | 'postponeReasons' | 'places' | 'jobTypes' | 'departments' | 'constraintWords' | 'pronunciations'

const LISTS: { id: ListId; title: string; explain: string }[] = [
  {
    id: 'certifications',
    title: tx('הסמכות'),
    explain: tx('אישורים שיש לעובדים, למשל עבודה בגובה'),
  },
  {
    id: 'shiftDefinitions',
    title: tx('תבניות עבודה'),
    explain: tx('יום, לילה, כוננות'),
  },
  {
    id: 'workKinds',
    title: tx('סוגי עבודה'),
    explain: tx('טיפוס, ריתוך... וכמה אנשים כל סוג צריך'),
  },
  {
    id: 'postponeReasons',
    title: tx('סיבות דחייה'),
    explain: tx('למה עבודת לילה נדחתה'),
  },
  {
    id: 'places',
    title: tx('מקומות'),
    explain: tx('מקומות עבודה שחוזרים, לבחירה מהירה'),
  },
  {
    id: 'jobTypes',
    title: tx('מהויות עבודה'),
    explain: tx('מהות עבודה שחוזרת, לבחירה מהירה'),
  },
  {
    id: 'departments',
    title: tx('מחלקות'),
    explain: tx('המחלקה של כל עובד'),
  },
  {
    id: 'constraintWords',
    title: tx('מילים לקריאת אילוצים'),
    explain: tx('איך מבינים תשובה מוואטסאפ'),
  },
  {
    id: 'pronunciations',
    title: tx('אימון הגייה'),
    explain: tx('שומעים מילים ששלי אומר, ומאשרים או מתקנים'),
  },
]

// Everything else the screen can open besides a list editor.
type PanelId = 'archive' | 'access' | 'security' | 'backup' | 'connection' | 'account' | 'feedback' | 'claudeLog'
type ItemId = ListId | PanelId

// A row inside a topic: a screen of this app, or a plain page outside it (public/*.html, a mail).
type Entry = { id: ItemId; title: string; explain: string } | { href: string; title: string; explain: string }

// Settings grouped by the app screen they belong to (the user's choice, 2026-11-06), so the
// manager looks for job settings under jobs and worker settings under workers. The first screen
// shows only the topics; a topic opens its own screen, and an item opens from there.
interface Group {
  id: string
  title: string
  explain: string
  icon: LucideIcon
  items: Entry[]
}

const PANELS: Record<PanelId, { title: string; explain: string }> = {
  archive: { title: tx('ארכיון ודוחות'), explain: tx('כל העבודות שהיו: מי עבד, איפה, ודוחות שבועיים וחודשיים') },
  access: { title: tx('מי יכול להיכנס'), explain: tx('הוספה והסרה של אנשים שמשתמשים באפליקציה') },
  security: { title: tx('אימות דו-שלבי'), explain: tx('קוד מהטלפון בכל כניסה, וקודי גיבוי') },
  backup: { title: tx('גיבוי ושחזור'), explain: tx('שמירת עותק של כל הנתונים והחזרה שלו') },
  connection: { title: tx('בדיקת חיבור לגוגל'), explain: tx('בודקת שהשמירה בדרייב והיומן עובדים') },
  account: { title: tx('החשבון שלי'), explain: tx('עם איזה מייל נכנסת, והתנתקות') },
  feedback: { title: tx('בקשת תכונות חדשות'), explain: tx('רעיון לשיפור? כותבים או מכתיבים, והוא נשלח למפתח') },
  claudeLog: { title: tx('מה הלך ל-Claude'), explain: tx('בקשות שלא בוצעו בחינם, למה, ומה Claude עשה. עם כפתור העתקה') },
}

const listItem = (id: ListId): Entry => {
  const l = LISTS.find((x) => x.id === id)!
  return { id, title: l.title, explain: l.explain }
}
const panelItem = (id: PanelId): Entry => ({ id, ...PANELS[id] })

function groups(isOwner: boolean, server: boolean): Group[] {
  const all: Group[] = [
    {
      id: 'jobs',
      title: tx('עבודות ושיבוץ'),
      explain: tx('מה שבוחרים כשפותחים עבודה ביומן ובמסך לשיבוץ'),
      icon: ClipboardList,
      items: [listItem('workKinds'), listItem('shiftDefinitions'), listItem('places'), listItem('jobTypes'), listItem('postponeReasons')],
    },
    {
      id: 'workers',
      title: tx('עובדים'),
      explain: tx('מה שמתארים לכל עובד במסך העובדים'),
      icon: Users,
      items: [listItem('certifications'), listItem('departments'), listItem('constraintWords')],
    },
    {
      id: 'archive',
      title: tx('ארכיון'),
      explain: tx('עבודות שכבר עברו, ודוחות'),
      icon: ArchiveIcon,
      items: [panelItem('archive')],
    },
    {
      id: 'security',
      title: tx('גישה ואבטחה'),
      explain: tx('מי נכנס לאפליקציה ואיך'),
      icon: ShieldCheck,
      items: [...(isOwner ? [panelItem('access')] : []), ...(server ? [panelItem('security')] : [])],
    },
    {
      id: 'data',
      title: tx('נתונים וגוגל'),
      explain: tx('גיבוי, ובדיקה שהחיבור לגוגל עובד'),
      icon: HardDrive,
      items: [panelItem('backup'), panelItem('connection')],
    },
    {
      id: 'legal',
      title: tx('מידע משפטי ונגישות'),
      explain: tx('פרטיות, תנאי שימוש ונגישות'),
      icon: Scale,
      // Plain pages outside the app, so they also open without signing in.
      items: [
        { href: '/privacy.html', title: tx('מדיניות פרטיות'), explain: tx('איזה מידע נשמר, איפה, מי רואה אותו, והזכויות שלך') },
        { href: '/terms.html', title: tx('תנאי שימוש'), explain: tx('הכללים לשימוש באפליקציה, ומי אחראי על מה') },
        { href: '/accessibility.html', title: tx('הצהרת נגישות'), explain: tx('מה נגיש, מה עוד לא, ואיך מדווחים על בעיה') },
        {
          href: 'mailto:shalom.eliy@gmail.com?subject=Shaly',
          title: tx('פנייה בנושא פרטיות או נגישות'),
          explain: tx('בקשה לראות, לתקן או למחוק מידע, או דיווח על בעיית נגישות'),
        },
      ],
    },
    {
      id: 'feedback',
      title: tx('בקשת תכונות חדשות'),
      explain: tx('רעיון לשיפור? כותבים או מכתיבים, והוא נשלח למפתח'),
      icon: Lightbulb,
      // Sent by the server, so it shows only where the server is on.
      items: server ? [panelItem('feedback')] : [],
    },
    {
      id: 'assistant',
      title: tx('העוזר הקולי'),
      explain: tx('איך שלי מבטא מילים, ומה הלך ל-Claude'),
      icon: Mic,
      // The assistant is the owner's only (the dev server has no sign-in).
      items: (isOwner && server) || import.meta.env.DEV ? [listItem('pronunciations'), panelItem('claudeLog')] : [],
    },
    {
      id: 'account',
      title: tx('החשבון שלי'),
      explain: tx('עם איזה מייל נכנסת, והתנתקות'),
      icon: UserCircle,
      items: [panelItem('account')],
    },
  ]
  return all.filter((g) => g.items.length > 0)
}

const isList = (id: ItemId): id is ListId => LISTS.some((l) => l.id === id)
// A topic with one screen in it opens that screen straight away.
const only = (g: Group): ItemId | null => (g.items.length === 1 && 'id' in g.items[0] ? g.items[0].id : null)

// One history entry while a topic or an item is open, so the phone's Back steps out one level.
function useBackTo(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return
    return holdBack(() => {
      close()
      return false
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
}

// The archive lives here too (the user's choice, 2026-11-06): the bottom bar keeps five buttons.
export function Settings({ openArchive = false }: { openArchive?: boolean }) {
  const logout = useAuth((s) => s.logout)
  const who = useAuth((s) => s.who)
  const [groupId, setGroupId] = useState<string | null>(null)
  const [open, setOpen] = useState<ItemId | null>(openArchive ? 'archive' : null)
  useBackTo(groupId !== null, () => setGroupId(null))
  useBackTo(open !== null, () => setOpen(null))
  // The editors read each other's lists (names, usage counts), so they load together.
  const lists = {
    certifications: useDriveList('certifications'),
    shiftDefinitions: useDriveList('shiftDefinitions'),
    postponeReasons: useDriveList('postponeReasons'),
    places: useDriveList('places'),
    jobTypes: useDriveList('jobTypes'),
    workKinds: useDriveList('workKinds'),
    departments: useDriveList('departments'),
    constraintWords: useDriveList('constraintWords'),
    pronunciations: useDriveList('pronunciations'),
    workers: useDriveList('workers'),
    shifts: useDriveList('shifts'),
    pendingJobs: useDriveList('pendingJobs'),
  }
  const all = Object.values(lists)
  const loading = all.some((l) => l.query.isPending)
  const failed = all.find((l) => l.query.isError)
  const retry = () => all.forEach((l) => l.query.isError && l.query.refetch())
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
  const topics = groups(who?.isOwner === true, authMode() === 'server')
  const group = topics.find((g) => g.id === groupId)

  const backButton = (label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className="flex min-h-11 items-center gap-1 text-sky-300">
      <ChevronRight size={20} aria-hidden />
      {label}
    </button>
  )
  // From an item, Back goes to its topic; from a topic opened straight to its one item, to the first screen.
  const back = backButton(group ? group.title : tx('הגדרות'), () => setOpen(null))

  if (open === 'archive')
    return (
      <>
        <div className="px-4 pt-4">{back}</div>
        <Archive />
      </>
    )

  if (open && !isList(open))
    return (
      <section className="space-y-4 px-4 pt-6">
        {back}
        {open === 'access' && <AccessSection />}
        {open === 'security' && <SecuritySection />}
        {/* Restore replaces the owner's data for everyone; without the server, everyone is on their own Drive. */}
        {open === 'backup' &&
          (failed ? (
            <DriveError error={failed.query.error} action="load" onRetry={retry} />
          ) : loading ? (
            <Loading />
          ) : (
            <BackupSection canRestore={authMode() === 'popup' || who?.isOwner === true} />
          ))}
        {open === 'connection' && <ConnectionCheck />}
        {open === 'feedback' && <FeatureRequestSection />}
        {open === 'claudeLog' && <ClaudeLogSection />}
        {open === 'account' && (
          <div className="space-y-3">
            <h1 className="text-2xl font-bold">{tx('החשבון שלי')}</h1>
            {who && (
              <p className="text-sm text-slate-400">
                {tx('מחובר כ-')}<span dir="ltr">{who.email}</span>
              </p>
            )}
            <button type="button" onClick={logout} className="w-full rounded-xl border border-slate-700 py-3 text-slate-300">
              {tx('התנתקות')}
            </button>
            {authMode() === 'server' && <p className="text-xs text-slate-500">{tx('מנתק רק את המכשיר הזה. שאר המכשירים נשארים מחוברים.')}</p>}
          </div>
        )}
      </section>
    )

  const current = LISTS.find((l) => l.id === open)
  if (current)
    return (
      <section className="space-y-4 px-4 pt-6">
        {back}
        <h1 className="text-2xl font-bold">{current.title}</h1>
        {current.id === 'certifications' && <TagSection />}
        {current.id === 'shiftDefinitions' && <ShiftsSection />}
        {current.id === 'postponeReasons' && <ReasonsSection />}
        {current.id === 'places' && <NameListSection kind="places" />}
        {current.id === 'jobTypes' && <NameListSection kind="jobTypes" />}
        {current.id === 'workKinds' && <WorkKindsSection />}
        {current.id === 'departments' && <DepartmentsSection />}
        {current.id === 'constraintWords' && <WordsSection />}
        {current.id === 'pronunciations' && <PronunciationSection />}
      </section>
    )

  if (group) {
    const hasLists = group.items.some((e) => 'id' in e && isList(e.id))
    return (
      <section className="space-y-4 px-4 pt-6">
        {backButton(tx('הגדרות'), () => setGroupId(null))}
        <h1 className="text-2xl font-bold">{group.title}</h1>
        {hasLists && failed && <DriveError error={failed.query.error} action="load" onRetry={retry} />}
        <ul className="divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
          {group.items.map((e) => {
            const body = (
              <span className="flex-1">
                <span className="block font-semibold">{e.title}</span>
                <span className="block text-xs text-slate-400">{e.explain}</span>
              </span>
            )
            if ('href' in e)
              return (
                <li key={e.href}>
                  <a
                    href={e.href}
                    target={e.href.startsWith('mailto:') ? undefined : '_blank'}
                    rel="noopener"
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start"
                  >
                    {body}
                    <ExternalLink size={16} aria-hidden className="shrink-0 text-slate-500" />
                  </a>
                </li>
              )
            const list = isList(e.id)
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => setOpen(e.id)}
                  disabled={list && (loading || !!failed)}
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start disabled:opacity-60"
                >
                  {body}
                  {list && !failed && (
                    <span className="shrink-0 text-sm text-slate-400">
                      {loading ? <Loader2 className="animate-spin" size={16} aria-label={tx('טוען')} /> : count(e.id as ListId)}
                    </span>
                  )}
                  <ChevronLeft size={18} aria-hidden className="shrink-0 text-slate-500" />
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    )
  }

  return (
    <section className="space-y-4 px-4 pt-6">
      <h1 className="text-2xl font-bold">{tx('הגדרות')}</h1>
      <LanguagePicker />
      <ul className="divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
        {topics.map((g) => (
          <li key={g.id}>
            <button
              type="button"
              onClick={() => {
                const one = only(g)
                if (one) setOpen(one)
                else setGroupId(g.id)
              }}
              className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start"
            >
              <g.icon size={22} aria-hidden className="shrink-0 text-sky-300" />
              <span className="flex-1">
                <span className="block font-semibold">{g.title}</span>
                <span className="block text-xs text-slate-400">{g.explain}</span>
              </span>
              <ChevronLeft size={18} aria-hidden className="shrink-0 text-slate-500" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Loading() {
  return (
    <p className="flex items-center gap-2 text-slate-400">
      <Loader2 className="animate-spin" size={18} aria-hidden />
      {tx('טוען מגוגל דרייב...')}
    </p>
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
      <h2 className="text-lg font-semibold">{tx('בדיקת חיבור לגוגל')}</h2>
      <p className="mt-1 text-sm text-slate-400">{tx('בודקת שהאפליקציה יכולה לשמור בדרייב ולכתוב ליומן. אירוע הבדיקה נמחק בסוף.')}</p>
      <ol className="mt-4 space-y-2">
        {steps.map((s) => (
          <li key={s.label} className="flex items-start gap-2 text-sm">
            {s.state === 'ok' && <CheckCircle2 className="shrink-0 text-emerald-400" size={18} aria-label={tx('הצליח')} />}
            {s.state === 'fail' && <XCircle className="shrink-0 text-red-400" size={18} aria-label={tx('נכשל')} />}
            {s.state === 'running' && <Loader2 className="shrink-0 animate-spin text-sky-400" size={18} aria-label={tx('רץ')} />}
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
        {running ? tx('בודק...') : tx('הרץ בדיקה')}
      </button>
    </div>
  )
}
