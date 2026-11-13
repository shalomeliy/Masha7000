import { useState } from 'react'
import dayjs from 'dayjs'
import { loadAudit, type AuditEntry } from '../../lib/google/owner'
import { tx } from '../../i18n'

// Settings > אבטחה, owner only: the security log the server keeps (api/_lib/audit.ts). Sign-ins,
// wrong two-step codes and every change to who may get in. Reviewing it now and then is part of
// the security routine (docs/compliance/logging-and-monitoring.md).

const LABEL: Record<string, string> = {
  signin: tx('כניסה עם גוגל'),
  'signin-refused': tx('כניסה נדחתה'),
  'mfa-ok': tx('קוד אימות נכון'),
  'mfa-wrong': tx('קוד אימות שגוי'),
  'mfa-locked': tx('יותר מדי קודים שגויים: נחסם זמנית'),
  'mfa-enrolled': tx('הוגדרה אפליקציית אימות'),
  'mfa-reset': tx('אימות אופס למנהל'),
  'recovery-used': tx('נכנס עם קוד גיבוי'),
  'recovery-new': tx('נוצרו קודי גיבוי חדשים'),
  'logout-all': tx('נותק מכל המכשירים'),
  'access-add': tx('מנהל נוסף לרשימה'),
  'access-remove': tx('מנהל הוסר מהרשימה'),
  'assistant-access': tx('שינוי גישה לעוזר הקולי'),
  'drive-connect': tx('Drive חובר'),
  'drive-disconnect': tx('Drive נותק'),
  'apikey-create': tx('נוצר מפתח API'),
  'apikey-revoke': tx('בוטל מפתח API'),
}

const WARN = new Set(['signin-refused', 'mfa-wrong', 'mfa-locked', 'recovery-used'])

export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const show = async () => {
    setLoading(true)
    setError(null)
    try {
      setEntries((await loadAudit()).entries)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2 border-t border-slate-800 pt-3">
      <h3 className="font-semibold">{tx('יומן אבטחה')}</h3>
      <p className="text-xs text-slate-500">
        {tx('כל כניסה, קוד שגוי ושינוי בהרשאות נרשמים כאן, עם השעה וכתובת מקוצרת. נשמרים 1000 האירועים האחרונים. כדאי לעבור על היומן פעם בחודש.')}
      </p>
      {entries === null ? (
        <button type="button" disabled={loading} onClick={show} className="w-full rounded-xl border border-slate-700 py-3 text-slate-300">
          {tx('הצגת יומן האבטחה')}
        </button>
      ) : entries.length === 0 ? (
        <p className="text-sm text-slate-400">{tx('עוד אין אירועים ביומן.')}</p>
      ) : (
        <ul className="max-h-96 space-y-1 overflow-y-auto text-sm">
          {entries.map((e, i) => (
            <li key={`${e.at}-${i}`} className="rounded-lg bg-slate-900 px-3 py-2">
              <div className="flex justify-between gap-2">
                <span className={WARN.has(e.event) ? 'text-amber-300' : 'text-slate-200'}>{LABEL[e.event] ?? e.event}</span>
                <span className="shrink-0 text-xs text-slate-500" dir="ltr">
                  {dayjs(e.at).format('DD.MM.YY HH:mm')}
                </span>
              </div>
              <div className="truncate text-xs text-slate-500" dir="ltr">
                {[e.email, e.target, e.ip].filter(Boolean).join(' · ')}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}
