import { Archive, CalendarDays, Settings, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type Tab = 'calendar' | 'workers' | 'archive' | 'settings'

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'calendar', label: 'יומן', icon: CalendarDays },
  { id: 'workers', label: 'עובדים', icon: Users },
  { id: 'archive', label: 'ארכיון', icon: Archive },
  { id: 'settings', label: 'הגדרות', icon: Settings },
]

export function BottomNav({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 border-t border-slate-800 bg-slate-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {TABS.map(({ id, label, icon: Icon }) => (
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
