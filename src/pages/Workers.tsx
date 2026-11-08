import { tx } from '../i18n'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { DriveError } from '../components/DriveError'
import { useDriveList } from '../lib/data/useDriveList'
import { onHint, recentHint, type Hint } from '../lib/hint'
import { WorkersSection, type WorkersTab } from './workers/WorkersSection'

// Certifications and shift templates are edited in Settings; this screen is about people:
// the team list, and one tab per thing the manager does with the team.
const TABS: { id: WorkersTab; label: string }[] = [
  { id: 'team', label: tx('הצוות') },
  { id: 'request', label: tx('אילוצים') },
  { id: 'join', label: tx('הצטרפות') },
  { id: 'search', label: tx('חיפוש') },
]

// The voice assistant's "press here" points at a button that lives in one of the tabs.
const HINT_TAB: Partial<Record<Hint, WorkersTab>> = { requestConstraints: 'request', joinLink: 'join' }

export function Workers() {
  const [tab, setTab] = useState<WorkersTab>(() => {
    const hint = recentHint()
    return (hint && HINT_TAB[hint]) || 'team'
  })
  useEffect(
    () =>
      onHint((id) => {
        const target = HINT_TAB[id]
        if (target) setTab(target)
      }),
    [],
  )
  // The workers' cards and forms read the other lists (names, shifts), so they load together.
  const lists = [useDriveList('workers'), useDriveList('certifications'), useDriveList('shiftDefinitions')]
  const loading = lists.some((l) => l.query.isPending)
  const failed = lists.find((l) => l.query.isError)

  return (
    <section className="space-y-4 px-4 pt-6">
      <h1 className="text-2xl font-bold">{tx('עובדים')}</h1>

      <div role="tablist" aria-label={tx('מה להציג')} className="grid grid-cols-4 rounded-xl bg-slate-900 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`min-h-11 rounded-lg text-sm font-medium ${tab === t.id ? 'bg-slate-700 text-slate-50' : 'text-slate-400'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {failed ? (
        <DriveError error={failed.query.error} action="load" onRetry={() => lists.forEach((l) => l.query.isError && l.query.refetch())} />
      ) : loading ? (
        <p className="flex items-center gap-2 text-slate-400">
          <Loader2 className="animate-spin" size={18} aria-hidden />
          {tx('טוען מגוגל דרייב...')}
        </p>
      ) : (
        <div role="tabpanel">
          <WorkersSection tab={tab} />
        </div>
      )}
    </section>
  )
}
