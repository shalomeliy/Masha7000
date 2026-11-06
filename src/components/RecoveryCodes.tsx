import { useState } from 'react'
import { Copy, KeyRound } from 'lucide-react'

/** The 10 one-time backup codes, shown once right after they are made. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 font-semibold text-emerald-300">
        <KeyRound size={18} aria-hidden />
        מוכן. אלה 10 קודי גיבוי.
      </p>
      <p className="text-sm text-slate-300">
        אם הטלפון יאבד, כל קוד מכניס פעם אחת במקום הקוד מהאפליקציה. שמור אותם עכשיו במקום בטוח שאינו הטלפון הזה, למשל רשום על דף או שמור בהערה במחשב.
      </p>
      <ul dir="ltr" className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-center font-mono text-lg select-all">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(codes.join('\n')).then(() => setCopied(true), () => {})
        }}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-700 text-slate-200"
      >
        <Copy size={16} aria-hidden />
        {copied ? 'הועתק' : 'העתקת הקודים'}
      </button>
      <button type="button" onClick={onDone} className="min-h-12 w-full rounded-xl bg-sky-500 font-semibold text-slate-950">
        שמרתי, אפשר להמשיך
      </button>
    </div>
  )
}
