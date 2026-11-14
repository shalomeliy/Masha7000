import { tx } from '../i18n'
import { useState } from 'react'
import { Loader2, ShieldCheck, Smartphone } from 'lucide-react'
import { encode } from 'uqr'
import { RecoveryCodes } from '../components/RecoveryCodes'
import { inputClass } from '../components/Sheet'
import { enableMfa, spaced, startSetup, verifyMfa } from '../lib/google/mfa'
import { useAuth } from '../store/auth'

// Two-step sign-in, right after Google. Like a second lock on the door: Google proves the email,
// and a 6-digit code from an authenticator app on the person's phone proves it is really them.
// First time: set the app up (one tap on the phone, or scan the square from another screen),
// type one code, keep the 10 backup codes. Later devices: type a code.

type Stage = { kind: 'intro' } | { kind: 'scan'; secret: string; uri: string } | { kind: 'codes'; codes: string[] }

export function TwoStep() {
  const { who, enrolled, check, logout } = useAuth()
  const [stage, setStage] = useState<Stage>({ kind: 'intro' })
  const [code, setCode] = useState('')
  const [backup, setBackup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const begin = () => run(async () => setStage({ kind: 'scan', ...(await startSetup()) }))
  const confirmSetup = () => run(async () => setStage({ kind: 'codes', codes: (await enableMfa(code)).recoveryCodes }))
  const verify = () =>
    run(async () => {
      await verifyMfa(code)
      await check()
    })

  const codeField = (onDone: () => void) => (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (code.trim()) onDone()
      }}
    >
      <label className="block space-y-1">
        <span className="text-sm text-slate-300">{backup ? tx('קוד גיבוי (8 תווים)') : tx('הקוד מהאפליקציה (6 ספרות)')}</span>
        <input
          dir="ltr"
          inputMode={backup ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          maxLength={backup ? 12 : 6}
          value={code}
          onChange={(e) => setCode(backup ? e.target.value : e.target.value.replace(/\D/g, ''))}
          className={`${inputClass} text-center text-2xl tracking-[0.3em]`}
          placeholder={backup ? 'XXXX-XXXX' : '000000'}
          autoFocus
        />
      </label>
      <button type="submit" disabled={busy || !code.trim()} className="min-h-12 w-full rounded-xl bg-sky-500 font-semibold text-slate-950 disabled:opacity-50">
        {busy ? tx('בודק...') : tx('אישור')}
      </button>
    </form>
  )

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-5 px-6 py-8">
      <div className="space-y-2">
        <ShieldCheck size={36} className="text-sky-400" aria-hidden />
        <h1 className="text-2xl font-bold">{tx('אימות דו-שלבי')}</h1>
        {who && (
          <p className="text-sm text-slate-400">
            {tx('מחובר כ-')}<span dir="ltr">{who.email}</span>
          </p>
        )}
      </div>

      {enrolled ? (
        <>
          <p className="text-slate-300">
            {backup ? tx('הקלד אחד מקודי הגיבוי ששמרת. כל קוד עובד פעם אחת בלבד.') : tx('פתח את אפליקציית האימות בטלפון והקלד את הקוד של Shali (אם הוספת אותו לפני שינוי השם, הוא מופיע שם בשם Shaly / ShiftSmart).')}
          </p>
          {codeField(verify)}
          <button
            type="button"
            onClick={() => {
              setBackup(!backup)
              setCode('')
              setError(null)
            }}
            className="min-h-11 text-sm text-sky-300"
          >
            {backup ? tx('יש לי את הטלפון, חזרה לקוד מהאפליקציה') : tx('אין לי את הטלפון: כניסה עם קוד גיבוי')}
          </button>
          {backup && !who?.isOwner && <p className="text-xs text-slate-500">{tx('אין לך גם קודי גיבוי? בקש מהמנהל לאפס לך את האימות בהגדרות, ואז תגדיר אותו מחדש.')}</p>}
        </>
      ) : stage.kind === 'intro' ? (
        <>
          <p className="text-slate-300">
            {tx('כדי לשמור על פרטי העובדים, הכניסה צריכה מנעול שני: קוד של 6 ספרות מאפליקציה בטלפון שלך, שמתחלף כל חצי דקה. מגדירים פעם אחת.')}
          </p>
          <ol className="list-decimal space-y-1 pe-5 text-sm text-slate-300">
            <li>
              {tx('מתקינים בטלפון אפליקציית אימות חינמית:')}{' '}<b>Google Authenticator</b> {tx('או')}{' '}<b>Microsoft Authenticator</b>.
            </li>
            <li>{tx('לוחצים כאן "הכנת קוד" ומוסיפים את Shali לאפליקציה.')}</li>
            <li>{tx('מקלידים כאן את 6 הספרות שהאפליקציה מראה.')}</li>
          </ol>
          <button type="button" onClick={begin} disabled={busy} className="min-h-12 w-full rounded-xl bg-sky-500 font-semibold text-slate-950 disabled:opacity-50">
            {busy ? <Loader2 className="mx-auto animate-spin" size={20} aria-label={tx('מכין')} /> : tx('הכנת קוד')}
          </button>
        </>
      ) : stage.kind === 'scan' ? (
        <>
          <a
            href={stage.uri}
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-sky-500 font-semibold text-sky-200"
          >
            <Smartphone size={18} aria-hidden />
            {tx('הוספה לאפליקציית האימות בטלפון הזה')}
          </a>
          <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <p className="text-sm text-slate-300">{tx('נכנסת מהמחשב? סרוק את הריבוע עם אפליקציית האימות בטלפון:')}</p>
            <QrSquare text={stage.uri} />
            <p className="text-sm text-slate-400">{tx('או הקלד באפליקציה את המפתח הזה:')}</p>
            <p dir="ltr" className="break-all text-center font-mono text-base tracking-wider text-slate-100 select-all">
              {spaced(stage.secret)}
            </p>
          </div>
          {codeField(confirmSetup)}
          <button type="button" onClick={begin} disabled={busy} className="min-h-11 text-sm text-slate-400">
            {tx('התחלה מחדש')}
          </button>
        </>
      ) : (
        <RecoveryCodes codes={stage.codes} onDone={() => void check()} />
      )}

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}

      <button type="button" onClick={() => void logout()} className="min-h-11 text-sm text-slate-400">
        {tx('התנתקות / כניסה עם מייל אחר')}
      </button>
    </main>
  )
}

/** The otpauth link as a QR square, drawn as SVG cells (no image, nothing leaves the page). */
function QrSquare({ text }: { text: string }) {
  const qr = encode(text, { ecc: 'M', border: 2 })
  const cells: string[] = []
  qr.data.forEach((row, y) => row.forEach((on, x) => on && cells.push(`M${x} ${y}h1v1h-1z`)))
  return (
    <svg viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={tx('קוד QR להוספה לאפליקציית האימות')} className="mx-auto w-48 rounded-lg bg-white" shapeRendering="crispEdges">
      <path d={cells.join('')} fill="#000" />
    </svg>
  )
}
