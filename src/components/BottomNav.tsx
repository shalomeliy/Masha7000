import { CalendarDays, ClipboardList, Mic, Settings, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type Tab = 'voice' | 'calendar' | 'toSchedule' | 'workers' | 'archive' | 'settings'

// 'archive' has no button of its own: it opens inside "הגדרות".
const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'calendar', label: 'יומן', icon: CalendarDays },
  { id: 'toSchedule', label: 'לשיבוץ', icon: ClipboardList },
  { id: 'voice', label: 'עוזר', icon: Mic },
  { id: 'workers', label: 'עובדים', icon: Users },
  { id: 'settings', label: 'הגדרות', icon: Settings },
]

// `voice` only for the owner: the assistant spends the owner's Anthropic credit.
export function BottomNav({ active, onChange, voice }: { active: Tab; onChange: (tab: Tab) => void; voice: boolean }) {
  const tabs = TABS.filter((t) => voice || t.id !== 'voice')
  return (
    <nav className="fixed inset-x-0 bottom-0 border-t border-slate-800 bg-slate-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className={`mx-auto grid max-w-md ${tabs.length === 5 ? 'grid-cols-5' : 'grid-cols-4'}`}>
        {tabs.map(({ id, label, icon: Icon }) => (
          <li key={id}>
            {id === 'voice' ? (
              // The assistant stands out: a raised round button in the middle, with a bright ring.
              <button
                type="button"
                onClick={() => onChange(id)}
                aria-current={active === id ? 'page' : undefined}
                className="flex w-full flex-col items-center gap-0.5 pb-2 text-xs font-semibold text-amber-300"
              >
                <span
                  className={`-mt-5 flex size-14 items-center justify-center rounded-full border-4 border-amber-400 shadow-lg shadow-amber-500/30 ${
                    active === id ? 'bg-amber-400 text-slate-950' : 'bg-slate-900 text-amber-300'
                  }`}
                >
                  <Icon size={26} aria-hidden />
                </span>
                {label}
              </button>
            ) : (
            <button
              type="button"
              onClick={() => onChange(id)}
              aria-current={active === id || (id === 'settings' && active === 'archive') ? 'page' : undefined}
              className={`flex w-full flex-col items-center gap-1 py-3 text-xs ${
                active === id || (id === 'settings' && active === 'archive') ? 'text-sky-400' : 'text-slate-400'
              }`}
            >
              <Icon size={22} aria-hidden />
              {label}
            </button>
            )}
          </li>
        ))}
      </ul>
    </nav>
  )
}
