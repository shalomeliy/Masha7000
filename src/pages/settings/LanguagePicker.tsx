import { Languages } from 'lucide-react'
import { language, setLanguage, tx } from '../../i18n'
import { LANGUAGES } from '../../i18n/languages'

// The app's language, kept on this device. "Language" is also written in English, so someone who
// picked a language they cannot read can still find the way back.
export function LanguagePicker() {
  const now = language()
  const label = tx('שפה')
  return (
    <label className="flex min-h-14 items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-2">
      <Languages size={22} aria-hidden className="shrink-0 text-sky-300" />
      <span className="flex-1">
        <span className="block font-semibold">{now.code === 'en' ? label : `${label} · Language`}</span>
        <span className="block text-xs text-slate-400">{tx('השפה של האפליקציה במכשיר הזה, גם של העוזר הקולי')}</span>
      </span>
      <select
        value={now.code}
        onChange={(e) => setLanguage(e.target.value)}
        className="min-h-11 shrink-0 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code} dir={l.dir}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  )
}
