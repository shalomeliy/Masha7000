import { tx } from '../../i18n'
import { Check, Moon, MoonStar, Sun } from 'lucide-react'
import { endsNextDay } from '../../lib/catalog'
import { useDriveList } from '../../lib/data/useDriveList'
import type { ShiftDefinition } from '../../types/models'

// The "תבנית עבודה" picker: יום / לילה / לינה. Used when a job is created in "לשיבוץ" and when it is put in the calendar.

const DefIcon = ({ def }: { def: ShiftDefinition }) => {
  const Icon = def.thenJob ? MoonStar : endsNextDay(def) ? Moon : Sun
  return <Icon size={18} aria-hidden />
}

export function ShiftDefField({ value, onChange }: { value: string | undefined; onChange: (id: string) => void }) {
  const defs = useDriveList('shiftDefinitions')
  return (
    <fieldset className="space-y-2 rounded-2xl border-2 border-sky-500/60 bg-sky-500/5 p-3">
      <legend className="px-1 text-base font-semibold text-slate-100">{tx('תבנית עבודה')}</legend>
      {defs.items.length ? (
        <div className="grid grid-cols-3 gap-2">
          {defs.items.map((d) => {
            const on = value === d.id
            return (
              <button
                key={d.id}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(d.id)}
                className={`flex min-h-14 items-center justify-center gap-1.5 rounded-xl border-2 px-2 text-base font-semibold ${
                  on ? 'border-sky-400 bg-sky-500 text-slate-950 shadow-lg shadow-sky-500/30' : 'border-slate-600 bg-slate-900 text-slate-300'
                }`}
              >
                {on ? <Check size={18} strokeWidth={3} aria-hidden /> : <DefIcon def={d} />}
                {d.name}
              </button>
            )
          })}
        </div>
      ) : (
        <p className="text-sm text-amber-300">{tx('עוד אין תבניות עבודה. אפשר להוסיף אותן בלשונית "עובדים", "תבניות".')}</p>
      )}
    </fieldset>
  )
}
