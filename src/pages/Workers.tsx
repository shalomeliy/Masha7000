import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { DriveError } from '../components/DriveError'
import { useDriveList } from '../lib/data/useDriveList'
import { ShiftsSection } from './workers/ShiftsSection'
import { TagSection } from './workers/TagSection'
import { WorkersSection } from './workers/WorkersSection'

type Section = 'workers' | 'roles' | 'certifications' | 'shifts'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'workers', label: 'עובדים' },
  { id: 'roles', label: 'תפקידים' },
  { id: 'certifications', label: 'הסמכות' },
  { id: 'shifts', label: 'משמרות' },
]

export function Workers() {
  const [section, setSection] = useState<Section>('workers')
  // Every section reads the other lists (names, usage counts), so they load together.
  const lists = [useDriveList('workers'), useDriveList('roles'), useDriveList('certifications'), useDriveList('shiftDefinitions')]
  const loading = lists.some((l) => l.query.isPending)
  const failed = lists.find((l) => l.query.isError)

  return (
    <section className="space-y-4 px-4 pt-6">
      <h1 className="text-2xl font-bold">עובדים ומשמרות</h1>

      <div role="tablist" aria-label="מה להציג" className="grid grid-cols-4 rounded-xl bg-slate-900 p-1">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={section === s.id}
            onClick={() => setSection(s.id)}
            className={`min-h-11 rounded-lg text-sm font-medium ${section === s.id ? 'bg-slate-700 text-slate-50' : 'text-slate-400'}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {failed ? (
        <DriveError error={failed.query.error} action="load" onRetry={() => lists.forEach((l) => l.query.isError && l.query.refetch())} />
      ) : loading ? (
        <p className="flex items-center gap-2 text-slate-400">
          <Loader2 className="animate-spin" size={18} aria-hidden />
          טוען מגוגל דרייב...
        </p>
      ) : (
        <div role="tabpanel">
          {section === 'workers' && <WorkersSection />}
          {section === 'roles' && <TagSection kind="roles" />}
          {section === 'certifications' && <TagSection kind="certifications" />}
          {section === 'shifts' && <ShiftsSection />}
        </div>
      )}
    </section>
  )
}
