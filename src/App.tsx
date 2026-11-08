import { tx } from './i18n'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { BottomNav } from './components/BottomNav'
import type { Tab } from './components/BottomNav'
import { ensureWeeklyCopy } from './lib/backup'
import { applyWordSettings } from './lib/constraintWords'
import { applyPronunciations, BUILT_IN, unknownWords } from './lib/pronounce'
import { onSpoken } from './lib/speech'
import { language } from './i18n'
import { newId } from './lib/catalog'
import { useDriveList } from './lib/data/useDriveList'
import { Calendar } from './pages/Calendar'
import { Settings } from './pages/Settings'
import { Workers } from './pages/Workers'
import { ConstraintAnswersSync } from './pages/workers/ConstraintFormSection'
import { SignIn } from './pages/SignIn'
import { ToSchedule } from './pages/ToSchedule'
import { Voice } from './pages/Voice'
import { useAuth } from './store/auth'

// Shown once per device, after Google: kept out of the first download.
const TwoStep = lazy(() => import('./pages/TwoStep').then((m) => ({ default: m.TwoStep })))

export default function App() {
  const status = useAuth((s) => s.status)
  const check = useAuth((s) => s.check)
  const who = useAuth((s) => s.who)
  // The voice assistant is the owner's main screen (only the owner may use it); locally it is always on.
  const voice = who?.isOwner === true || import.meta.env.DEV
  const [tab, setTab] = useState<Tab | null>(null)
  const shown: Tab = tab ?? (voice ? 'voice' : 'calendar')

  useEffect(() => {
    void check()
  }, [check])

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
  if (status !== 'signedIn') return <SignIn />

  return (
    <div className="mx-auto min-h-full max-w-md pb-24">
      <ConstraintWords />
      <Pronunciations />
      <NewWords />
      <WeeklyCopy />
      {/* Workers' answers to the weekly constraints form land in their constraints on any screen. */}
      <ConstraintAnswersSync />
      {shown === 'voice' && voice && <Voice onNavigate={setTab} />}
      {shown === 'calendar' && <Calendar />}
      {shown === 'toSchedule' && <ToSchedule />}
      {shown === 'workers' && <Workers />}
      {(shown === 'settings' || shown === 'archive') && <Settings key={shown} openArchive={shown === 'archive'} />}
      <BottomNav active={shown} onChange={setTab} voice={voice} />
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

// The week's automatic backup copy, made quietly on the first open of each week.
function WeeklyCopy() {
  const qc = useQueryClient()
  useEffect(() => {
    void ensureWeeklyCopy().then((made) => {
      if (made) void qc.invalidateQueries({ queryKey: ['backupCopies'] })
    })
  }, [qc])
  return null
}
