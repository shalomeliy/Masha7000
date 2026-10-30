import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { BottomNav } from './components/BottomNav'
import type { Tab } from './components/BottomNav'
import { applyWordSettings } from './lib/constraintWords'
import { useDriveList } from './lib/data/useDriveList'
import { Archive } from './pages/Archive'
import { Calendar } from './pages/Calendar'
import { Settings } from './pages/Settings'
import { Workers } from './pages/Workers'
import { SignIn } from './pages/SignIn'
import { ToSchedule } from './pages/ToSchedule'
import { useAuth } from './store/auth'

export default function App() {
  const status = useAuth((s) => s.status)
  const check = useAuth((s) => s.check)
  const [tab, setTab] = useState<Tab>('calendar')

  useEffect(() => {
    void check()
  }, [check])

  if (status === 'checking')
    return (
      <main className="flex min-h-full items-center justify-center gap-2 text-slate-400">
        <Loader2 className="animate-spin" size={20} aria-hidden />
        מתחבר...
      </main>
    )
  if (status !== 'signedIn') return <SignIn />

  return (
    <div className="mx-auto min-h-full max-w-md pb-24">
      <ConstraintWords />
      {tab === 'calendar' && <Calendar />}
      {tab === 'toSchedule' && <ToSchedule />}
      {tab === 'workers' && <Workers />}
      {tab === 'archive' && <Archive />}
      {tab === 'settings' && <Settings />}
      <BottomNav active={tab} onChange={setTab} />
    </div>
  )
}

// The manager's words for reading constraints (Settings), put into the reader before any screen uses it.
function ConstraintWords() {
  applyWordSettings(useDriveList('constraintWords').items)
  return null
}
