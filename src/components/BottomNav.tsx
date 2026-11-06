import { Archive, CalendarDays, ClipboardList, Mic, Settings, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type Tab = 'voice' | 'calendar' | 'toSchedule' | 'workers' | 'archive' | 'settings'

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'voice', label: 'עוזר', icon: Mic },
  { id: 'calendar', label: 'יומן', icon: CalendarDays },
  { id: 'toSchedule', label: 'לשיבוץ', icon: ClipboardList },
  { id: 'workers', label: 'עובדים', icon: Users },
  { id: 'archive', label: 'ארכיון', icon: Archive },
  { id: 'settings', label: 'הגדרות', icon: Settings },
]

// `voice` only for the owner: the assistant spends the owner's Anthropic credit.
export function BottomNav({ active, onChange, voice }: { active: Tab; onChange: (tab: Tab) => void; voice: boolean }) {
  const tabs = TABS.filter((t) => voice || t.id !== 'voice')
  return (
    <nav className="fixed inset-x-0 bottom-0 border-t border-slate-800 bg-slate-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className={`mx-auto grid max-w-md ${tabs.length === 6 ? 'grid-cols-6' : 'grid-cols-5'}`}>
        {tabs.map(({ id, label, icon: Icon }) => (
          <li key={id}>
            <button
              type="button"
              onClick={() => onChange(id)}
              aria-current={active === id ? 'page' : undefined}
              className={`flex w-full flex-col items-center gap-1 py-3 text-xs ${
                active === id ? 'text-sky-400' : 'text-slate-400'
              }`}
            >
              <Icon size={22} aria-hidden />
              {label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
