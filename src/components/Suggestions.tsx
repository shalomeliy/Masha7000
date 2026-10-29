import { useDriveList } from '../lib/data/useDriveList'
import { suggestions } from '../lib/lists'

// Tap-to-fill chips under a place or job field, from the manager's lists in Settings. The field stays
// free text: a chip only fills it.
export function Suggestions({ list, value, onPick }: { list: 'places' | 'jobTypes'; value: string; onPick: (name: string) => void }) {
  const items = useDriveList(list).items
  const shown = suggestions(value, items.map((i) => i.name))
  if (!shown.length) return null
  return (
    <div className="flex flex-wrap gap-2" aria-label={list === 'places' ? 'מקומות מהרשימה' : 'סוגי עבודה מהרשימה'}>
      {shown.map((name) => (
        <button key={name} type="button" onClick={() => onPick(name)} className="min-h-9 rounded-full border border-slate-700 px-3 text-sm text-slate-300">
          {name}
        </button>
      ))}
    </div>
  )
}
