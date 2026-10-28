import { useState } from 'react'
import { BottomNav } from './components/BottomNav'
import type { Tab } from './components/BottomNav'
import { Placeholder } from './pages/Placeholder'
import { Settings } from './pages/Settings'
import { SignIn } from './pages/SignIn'
import { useAuth } from './store/auth'

export default function App() {
  const signedIn = useAuth((s) => s.signedIn)
  const [tab, setTab] = useState<Tab>('settings')

  if (!signedIn) return <SignIn />

  return (
    <div className="mx-auto min-h-full max-w-md pb-24">
      {tab === 'calendar' && <Placeholder title="יומן משמרות" />}
      {tab === 'workers' && <Placeholder title="עובדים ותפקידים" />}
      {tab === 'archive' && <Placeholder title="ארכיון" />}
      {tab === 'settings' && <Settings />}
      <BottomNav active={tab} onChange={setTab} />
    </div>
  )
}
