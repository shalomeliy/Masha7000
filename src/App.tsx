import { tx } from './i18n'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { BottomNav } from './components/BottomNav'
import type { Tab } from './components/BottomNav'
import { ensureDailyCopy } from './lib/backup'
import { applyWordSettings } from './lib/constraintWords'
import { applyPronunciations, BUILT_IN, unknownWords } from './lib/pronounce'
import { onSpoken, unlockSpeech } from './lib/speech'
import { language } from './i18n'
import { newId } from './lib/catalog'
import { useDriveList } from './lib/data/useDriveList'
import { ConstraintAnswersSync } from './pages/workers/ConstraintFormSection'
import { SignIn } from './pages/SignIn'
import { CrashGuard } from './components/CrashGuard'
import { ScreenLoading } from './components/Skeleton'
import { useAuth } from './store/auth'
import { useFeatures } from './lib/data/useFeatures'
import { useOnboarding } from './store/onboarding'
import { applyFeatureRules } from './lib/featureRules'

// Each screen is its own download: the first screen comes down alone, the rest follow once the
// phone is idle, so moving between tabs does not wait.
const screens = {
  calendar: () => import('./pages/Calendar'),
  voice: () => import('./pages/Voice'),
  workers: () => import('./pages/Workers'),
  journal: () => import('./pages/Journal'),
  settings: () => import('./pages/Settings'),
}
const Calendar = lazy(() => screens.calendar().then((m) => ({ default: m.Calendar })))
const Voice = lazy(() => screens.voice().then((m) => ({ default: m.Voice })))
const Workers = lazy(() => screens.workers().then((m) => ({ default: m.Workers })))
const Journal = lazy(() => screens.journal().then((m) => ({ default: m.Journal })))
const Settings = lazy(() => screens.settings().then((m) => ({ default: m.Settings })))

function prefetchScreens() {
  const all = () => Object.values(screens).forEach((load) => void load().catch(() => {}))
  if ('requestIdleCallback' in window) requestIdleCallback(all, { timeout: 4000 })
  else setTimeout(all, 1500)
}

// Shown once per device, after Google: kept out of the first download.
const TwoStep = lazy(() => import('./pages/TwoStep').then((m) => ({ default: m.TwoStep })))
// Shown once to a new team (smart onboarding); kept out of the first download too.
const Onboarding = lazy(() => import('./pages/Onboarding').then((m) => ({ default: m.Onboarding })))

export default function App() {
  const status = useAuth((s) => s.status)
  const check = useAuth((s) => s.check)
  useEffect(() => {
    void check()
  }, [check])
  if (status === 'signedIn') return <SignedIn />
  if (status === 'checking')
    return (
      <main className="flex min-h-full items-center justify-center gap-2 text-slate-400">
        <Loader2 className="animate-spin" size={20} aria-hidden />
        {tx('מתחבר...')}
      </main>
    )
  if (status === 'needsMfa')
    return (
      <Suspense fallback={null}>
        <TwoStep />
      </Suspense>
    )
  return <SignIn />
}

function SignedIn() {
  const who = useAuth((s) => s.who)
  const { isOn, settings, loaded, flags } = useFeatures()
  const workers = useDriveList('workers')
  const forced = useOnboarding((s) => s.forced)
  // The wizard: a new team (no onboarding record and no workers ever saved), or asked for again from Settings.
  // Teams from before the wizard (the owner's) never see it on their own: no onboarding record = everything on.
  const fresh = loaded && !settings?.onboarding && workers.missing
  applyFeatureRules(flags, settings?.shiftHours)
  // The voice assistant is the main screen of whoever may use it (the owner, and managers the owner
  // opened it to in Settings); locally it is always on. Hidden when the team turned Shali off.
  // In an iPhone home-screen app it listens through the server (src/lib/serverListen.ts, back 2026-11-23).
  const voice = (who?.assistant === true || who?.isOwner === true || import.meta.env.DEV) && isOn('shali')
  const [tab, setTab] = useState<Tab | null>(null)
  const shown: Tab = tab ?? (voice ? 'voice' : 'calendar')
  // "הגדרות" tapped again from inside one of its screens (vehicles, archive...) goes back to its first screen.
  const [settingsRound, setSettingsRound] = useState(0)
  // Once opened, the assistant stays behind the other tabs, so a conversation is not lost on a
  // look at another screen (user, 2026-11-23).
  const [voiceOpened, setVoiceOpened] = useState(false)
  if (shown === 'voice' && !voiceOpened) setVoiceOpened(true)
  // A long press on the Shali button: Shali listens and answers here, on whatever screen is open (owner, 2026-11-26).
  const [quickTalk, setQuickTalk] = useState(0)
  const holdShali = () => {
    setVoiceOpened(true)
    setQuickTalk((n) => n + 1)
  }
  const go = (next: Tab) => {
    if (next === 'settings' && (shown === 'settings' || shown === 'archive')) setSettingsRound((n) => n + 1)
    setTab(next)
  }

  useEffect(() => {
    prefetchScreens()
  }, [])
  // A tab that was turned off while open falls back to the calendar.
  if (tab === 'journal' && !isOn('journal')) setTab('calendar')
  if (tab === 'archive' && !isOn('reports')) setTab('settings')

  if (forced || fresh)
    return (
      <Suspense fallback={<ScreenLoading />}>
        <Onboarding />
      </Suspense>
    )

  return (
    <div className="mx-auto min-h-full max-w-md pb-24">
      <ConstraintWords />
      <Pronunciations />
      <NewWords />
      <DailyCopy />
      {/* Workers' answers to the weekly constraints form land in their constraints on any screen. */}
      {isOn('constraintForm') && <ConstraintAnswersSync />}
      {/* "לשיבוץ" is no longer a screen: its waiting jobs are at the top of the calendar. */}
      {/* A screen that crashes shows a message in its place; the tabs below keep working. */}
      {voice && voiceOpened && (
        <div hidden={shown !== 'voice'}>
          <CrashGuard>
            <Suspense fallback={<ScreenLoading />}>
              <Voice active={shown === 'voice'} quickTalk={quickTalk} onOpen={() => setTab('voice')} onNavigate={(s) => setTab(s === 'toSchedule' ? 'calendar' : s)} />
            </Suspense>
          </CrashGuard>
        </div>
      )}
      <CrashGuard key={shown}>
        <Suspense fallback={shown === 'voice' ? null : <ScreenLoading />}>
          {shown === 'calendar' && <Calendar />}
          {shown === 'workers' && <Workers />}
          {shown === 'journal' && isOn('journal') && <Journal />}
          {(shown === 'settings' || shown === 'archive') && <Settings key={`${shown}-${settingsRound}`} openArchive={shown === 'archive'} />}
        </Suspense>
      </CrashGuard>
      <BottomNav active={shown} onChange={go} voice={voice} journal={isOn('journal')} onHold={holdShali} onHoldEnd={unlockSpeech} />
    </div>
  )
}

// The manager's words for reading constraints (Settings), put into the reader before any screen uses it.
function ConstraintWords() {
  applyWordSettings(useDriveList('constraintWords').items)
  return null
}

// How the assistant says words the phone's voice gets wrong (Settings), put in before it speaks.
function Pronunciations() {
  applyPronunciations(useDriveList('pronunciations').items)
  return null
}

// Words the assistant says that the manager has not listened to yet wait in "אימון הגייה" (Settings).
// The starting list is loaded only once something is said.
function NewWords() {
  const approved = useDriveList('approvedWords')
  const fixed = useDriveList('pronunciations')
  const fresh = useDriveList('newWords')
  const latest = useRef({ approved: approved.items, fixed: fixed.items, fresh: fresh.items, save: fresh.save, loaded: approved.query.isSuccess && fixed.query.isSuccess && fresh.query.isSuccess })
  useEffect(() => {
  latest.current = { approved: approved.items, fixed: fixed.items, fresh: fresh.items, save: fresh.save, loaded: approved.query.isSuccess && fixed.query.isSuccess && fresh.query.isSuccess }
  })
  useEffect(
    () =>
      onSpoken((text) => {
        if (language().code !== 'he' || !latest.current.loaded) return
        void import('./lib/pronunciationSeed').then(({ SEED_WORDS, EASY_WORDS }) => {
          const l = latest.current
          const known = new Set([...SEED_WORDS, ...EASY_WORDS, ...BUILT_IN.map((b) => b.word), ...l.approved.map((a) => a.word), ...l.fixed.map((p) => p.word), ...l.fresh.map((n) => n.word)])
          const add = unknownWords(text, known)
          if (!add.length) return
          const at = new Date().toISOString()
          void l.save([...l.fresh, ...add.map((word) => ({ id: newId(), word, at }))]).catch(() => {
            // not saved: the word comes again the next time it is said
          })
        })
      }),
    [],
  )
  return null
}

// The day's automatic backup copy, made quietly on the first open of each day.
function DailyCopy() {
  const qc = useQueryClient()
  useEffect(() => {
    void ensureDailyCopy().then((made) => {
      if (made) void qc.invalidateQueries({ queryKey: ['backupCopies'] })
    })
  }, [qc])
  return null
}
