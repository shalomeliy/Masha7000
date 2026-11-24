import { useState } from 'react'
import { ChevronDown, Mic } from 'lucide-react'
import { tx } from '../../i18n'
import { useFeatures } from '../../lib/data/useFeatures'
import { visibleChapters } from '../../lib/guide'

// Settings > "מדריך": how to do each thing, only for the screens this team has turned on.
export function GuideSection() {
  const { isOn } = useFeatures()
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{tx('מדריך')}</h1>
      <ul className="divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
        {visibleChapters(isOn).map((c) => (
          <li key={c.id}>
            <button type="button" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-start font-medium">
              {c.title}
              <ChevronDown size={18} aria-hidden className={`shrink-0 transition-transform ${open === c.id ? 'rotate-180' : ''}`} />
            </button>
            {open === c.id && (
              <div className="space-y-3 px-4 pb-4">
                <ol className="list-decimal space-y-1 ps-5 text-slate-300">
                  {c.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                {c.say && (
                  <div className="space-y-1 rounded-xl bg-amber-400/10 p-3 text-sm text-amber-100">
                    <p className="flex items-center gap-1 font-medium">
                      <Mic size={16} aria-hidden />
                      {tx('אפשר להגיד ל-Shali:')}
                    </p>
                    {c.say.map((s) => (
                      <p key={s}>"{s}"</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
