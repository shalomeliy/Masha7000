import { tx } from '../../i18n'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, KeyRound, Loader2, Trash2 } from 'lucide-react'
import { inputClass } from '../../components/Sheet'
import { createApiKey, listApiKeys, revokeApiKey } from '../../lib/google/apiKeys'

// Owner only: keys that let another system read (and, if allowed, write) the app's data through
// /api/v1. A new key is shown once; the server keeps only its hash. Revoking stops it at once.

const BASE = 'https://masha7000.vercel.app/api/v1'
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })

export function ApiSection() {
  const qc = useQueryClient()
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: listApiKeys })
  const [name, setName] = useState('')
  const [write, setWrite] = useState(false)
  const [personal, setPersonal] = useState(false)
  const [made, setMade] = useState<string | null>(null) // the new key, shown once
  const [copied, setCopied] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: () => createApiKey(name.trim(), write, personal),
    onSuccess: ({ key }) => {
      setMade(key)
      setCopied(false)
      setName('')
      setWrite(false)
      setPersonal(false)
      void qc.invalidateQueries({ queryKey: ['api-keys'] })
    },
  })
  const revoke = useMutation({
    mutationFn: revokeApiKey,
    onSuccess: () => {
      setConfirm(null)
      void qc.invalidateQueries({ queryKey: ['api-keys'] })
    },
  })
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(made ?? '')
      setCopied(true)
    } catch {
      // the key stays on screen to copy by hand
    }
  }
  const names = new Map((keys.data?.keys ?? []).map((k) => [k.id, k.name]))

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{tx('גישת API')}</h2>
      <p className="text-sm text-slate-400">{tx('מערכת אחרת נכנסת לנתונים עם מפתח. רק אתה יוצר ומבטל מפתחות. מפתח שבוטל מפסיק לעבוד מיד.')}</p>
      <p className="truncate rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-300" dir="ltr">
        {BASE}
      </p>

      {made && (
        <div role="status" className="space-y-2 rounded-2xl border border-amber-500/60 bg-amber-500/10 p-3">
          <p className="text-sm text-amber-100">{tx('המפתח החדש. העתק אותו עכשיו, הוא לא יוצג שוב:')}</p>
          <p className="break-all rounded-lg bg-slate-950 px-3 py-2 font-mono text-xs" dir="ltr">
            {made}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={copy} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-sky-500 font-semibold text-slate-950">
              <Copy size={16} aria-hidden />
              {copied ? tx('הועתק') : tx('העתקה')}
            </button>
            <button type="button" onClick={() => setMade(null)} className="min-h-11 rounded-xl border border-slate-700 px-4 text-slate-300">
              {tx('סגירה')}
            </button>
          </div>
        </div>
      )}

      {keys.isPending ? (
        <p className="flex items-center gap-2 text-slate-400">
          <Loader2 className="animate-spin" size={18} aria-hidden />
          {tx('טוען...')}
        </p>
      ) : keys.isError ? (
        <p role="alert" className="text-sm text-red-400">
          {(keys.error as Error).message}
        </p>
      ) : keys.data.keys.length === 0 ? (
        <p className="text-sm text-slate-500">{tx('אין מפתחות עדיין.')}</p>
      ) : (
        <ul className="divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
          {keys.data.keys.map((k) => (
            <li key={k.id} className="flex min-h-14 flex-wrap items-center gap-2 px-4 py-2 text-sm">
              <KeyRound size={16} className="text-slate-500" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{k.name}</p>
                <p className="text-xs text-slate-400">
                  {k.scopes.includes('write') ? tx('קריאה וכתיבה') : tx('קריאה בלבד')}
                  {k.personal && ` · ${tx('כולל פרטים אישיים')}`}
                  {' · '}
                  {k.lastUsed ? tx('שימוש אחרון: {when}', { when: when(k.lastUsed) }) : tx('עוד לא בשימוש')}
                </p>
              </div>
              <button
                type="button"
                disabled={revoke.isPending}
                onClick={() => (confirm === k.id ? revoke.mutate(k.id) : setConfirm(k.id))}
                className={`flex min-h-11 items-center gap-1 rounded-lg px-3 ${confirm === k.id ? 'bg-red-500/20 text-red-300' : 'text-slate-400'}`}
              >
                <Trash2 size={16} aria-hidden />
                {confirm === k.id ? tx('לבטל? לחץ שוב') : tx('ביטול מפתח')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="space-y-2 rounded-2xl border border-slate-800 p-3"
        onSubmit={(ev) => {
          ev.preventDefault()
          if (name.trim()) create.mutate()
        }}
      >
        <input
          maxLength={60}
          placeholder={tx('שם המפתח, למשל "דוחות שכר"')}
          aria-label={tx('שם המפתח')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`${inputClass} w-full`}
        />
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={write} onChange={(e) => setWrite(e.target.checked)} className="size-5" />
          {tx('גם כתיבה (יצירה ועדכון של עבודות, עובדים ואילוצים)')}
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={personal} onChange={(e) => setPersonal(e.target.checked)} className="size-5" />
          {tx('כולל פרטים אישיים')}
        </label>
        {personal && <p className="text-xs text-amber-300">{tx('ת.ז, טלפונים, כתובת והערות יוצאים רק במפתח כזה. תן אותו רק למערכת שחייבת אותם.')}</p>}
        <button type="submit" disabled={create.isPending || !name.trim()} className="min-h-11 w-full rounded-xl bg-sky-500 font-semibold text-slate-950 disabled:opacity-50">
          {tx('יצירת מפתח')}
        </button>
        {create.isError && (
          <p role="alert" className="text-sm text-red-400">
            {(create.error as Error).message}
          </p>
        )}
      </form>

      {revoke.isError && (
        <p role="alert" className="text-sm text-red-400">
          {(revoke.error as Error).message}
        </p>
      )}

      {keys.data && keys.data.log.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-slate-300">{tx('קריאות אחרונות')}</h3>
          <ul className="space-y-1 text-xs text-slate-400" dir="ltr">
            {keys.data.log.slice(0, 20).map((c, i) => (
              <li key={i} className={`flex gap-2 ${c.status >= 400 ? 'text-red-300' : ''}`}>
                <span className="shrink-0">{when(c.at)}</span>
                <span className="shrink-0">{c.status}</span>
                <span className="min-w-0 truncate">
                  {c.method} {c.path}
                </span>
                <span className="ms-auto shrink-0 truncate">{c.keyId ? (names.get(c.keyId) ?? '?') : '-'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
