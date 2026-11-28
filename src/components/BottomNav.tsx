import { tx } from '../i18n'
import { useRef } from 'react'
import { CalendarDays, Mic, NotebookPen, Settings, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type Tab = 'voice' | 'calendar' | 'workers' | 'journal' | 'archive' | 'settings'

// 'archive' has no button of its own: it opens inside "הגדרות". Jobs waiting for a day are in the calendar
// (the user removed the "לשיבוץ" button, 2026-11-13). "יומן אישי" sits right of "הגדרות", where "רכבים" was;
// the vehicles list moved into "הגדרות" (the user, 2026-11-20).
const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'calendar', label: tx('יומן'), icon: CalendarDays },
  { id: 'workers', label: tx('עובדים'), icon: Users },
  // In the middle of the five (the user, 2026-11-13).
  { id: 'voice', label: 'Shali', icon: Mic },
  { id: 'journal', label: tx('יומן אישי'), icon: NotebookPen },
  { id: 'settings', label: tx('הגדרות'), icon: Settings },
]

// `voice` only for the owner: the assistant spends the owner's Anthropic credit.
// `journal` false: the team turned "יומן אישי" off in Settings > מסכים ותכונות.
// Holding the yellow Shali button this long starts listening on whatever screen is open (owner, 2026-11-26; 1 second since 2026-11-28).
export const HOLD_MS = 1000

// `onHold`: the Shali button was held HOLD_MS; `onHoldEnd`: it was let go after that (a tap the phone
// counts, so the sound of the answer may start from it). A short tap still opens the Shali screen.
export function BottomNav({ active, onChange, voice, journal = true, onHold, onHoldEnd }: { active: Tab; onChange: (tab: Tab) => void; voice: boolean; journal?: boolean; onHold?: () => void; onHoldEnd?: () => void }) {
  const hold = useRef<{ timer?: ReturnType<typeof setTimeout>; fired: boolean; ended?: boolean }>({ fired: false })
  const holdStart = () => {
    clearTimeout(hold.current.timer)
    hold.current = {
      fired: false,
      timer: setTimeout(() => {
        hold.current.fired = true
        navigator.vibrate?.(40)
        onHold?.()
      }, HOLD_MS),
    }
  }
  const holdStop = () => {
    clearTimeout(hold.current.timer)
    if (!hold.current.fired || hold.current.ended) return
    hold.current.ended = true
    onHoldEnd?.()
  }
  const tabs = TABS.filter((t) => (voice || t.id !== 'voice') && (journal || t.id !== 'journal'))
  return (
    <nav className="fixed inset-x-0 bottom-0 border-t border-slate-800 bg-slate-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className={`mx-auto grid max-w-md ${tabs.length === 5 ? 'grid-cols-5' : tabs.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
        {tabs.map(({ id, label, icon: Icon }) => (
          <li key={id} className="min-w-0">
            {id === 'voice' ? (
              // The assistant stands out: a raised round button in the middle, with a bright ring.
              <button
                type="button"
                onPointerDown={holdStart}
                onPointerUp={holdStop}
                onPointerLeave={holdStop}
                onPointerCancel={holdStop}
                // A long press must not open the phone's menu or select the label.
                onContextMenu={(e) => e.preventDefault()}
                onClick={() => {
                  // The end of a long press is not also a tap.
                  if (hold.current.fired) {
                    hold.current.fired = false
                    return
                  }
                  onChange(id)
                }}
                aria-current={active === id ? 'page' : undefined}
                aria-description={onHold ? tx('לחיצה ארוכה: Shali מקשיב בלי לעזוב את המסך') : undefined}
                className="flex w-full touch-none select-none flex-col items-center gap-0.5 pb-2 text-xs font-semibold text-amber-300 [-webkit-touch-callout:none]"
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
              className={`flex w-full min-w-0 flex-col items-center gap-1 py-3 text-xs ${
                active === id || (id === 'settings' && active === 'archive') ? 'text-sky-400' : 'text-slate-400'
              }`}
            >
              <Icon size={22} aria-hidden />
              {/* A long word (German "Einstellungen") stays inside its own fifth of the bar. */}
              <span className="max-w-full truncate text-[11px] min-[380px]:text-xs">{label}</span>
            </button>
            )}
          </li>
        ))}
      </ul>
    </nav>
  )
}
