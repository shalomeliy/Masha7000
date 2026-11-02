import { Check } from 'lucide-react'
import { useDriveList } from '../../lib/data/useDriveList'
import { useStarterWorkKinds } from '../../lib/data/useStarterWorkKinds'
import { pickedKinds } from '../../lib/workKinds'
import type { WorkKind } from '../../types/models'

// "סוג עבודה": any number of kinds; each one picked adds the people it needs to "כמה אנשים צריך".

export function WorkKindField({ value, onToggle }: { value: string[] | undefined; onToggle: (kind: WorkKind) => void }) {
  useStarterWorkKinds()
  const kinds = useDriveList('workKinds')
  const picked = pickedKinds(value, kinds.items)
  if (!kinds.items.length) return null
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm text-slate-300">סוג עבודה (אפשר לבחור כמה)</legend>
      <div className="flex flex-wrap gap-2">
        {kinds.items.map((k) => {
          const on = picked.includes(k.id)
          return (
            <button
              key={k.id}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(k)}
              className={`flex min-h-11 items-center gap-1.5 rounded-xl border-2 px-3 text-sm font-semibold ${
                on ? 'border-sky-400 bg-sky-500 text-slate-950' : 'border-slate-600 bg-slate-900 text-slate-300'
              }`}
            >
              {on && <Check size={16} strokeWidth={3} aria-hidden />}
              {k.name}
              <span className={`text-xs font-normal ${on ? 'text-slate-800' : 'text-slate-400'}`}>{k.staffing.length === 1 ? 'אדם אחד' : `${k.staffing.length} אנשים`}</span>
            </button>
          )
        })}
      </div>
      {picked.length > 1 && <p className="text-xs text-slate-400">עובד שמתאים לכמה סוגים יכסה את כולם, ואז צריך פחות אנשים.</p>}
    </fieldset>
  )
}
