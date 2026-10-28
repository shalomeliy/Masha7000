import { rememberedAccount } from '../lib/google/auth'
import { GOOGLE_CLIENT_ID } from '../lib/google/config'
import { useAuth } from '../store/auth'

export function SignIn() {
  const { login, busy, error } = useAuth()
  const account = rememberedAccount()

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-3xl font-bold">ShiftSmart</h1>
        <p className="mt-2 text-slate-400">סידור עבודה 24/7, כוננות ואילוצי עובדים. הנתונים נשמרים בחשבון הגוגל שלך בלבד.</p>
      </div>

      {!GOOGLE_CLIENT_ID && (
        <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          חסר מזהה התחברות של גוגל. יש להעתיק את <code>.env.example</code> ל-<code>.env.local</code> ולמלא אותו.
        </p>
      )}

      <button
        type="button"
        onClick={login}
        disabled={busy || !GOOGLE_CLIENT_ID}
        className="rounded-xl bg-sky-500 py-4 text-lg font-semibold text-slate-950 disabled:opacity-50"
      >
        {busy ? 'מתחבר...' : account ? 'המשך' : 'התחברות עם Google'}
      </button>

      {account && !busy && (
        <p className="text-sm text-slate-400">
          {account.email ? `תמשיך כ-${account.email}. ` : ''}החיבור לגוגל מתחדש כל שעה, לחיצה אחת מחדשת אותו.
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-400">
          ההתחברות נכשלה: {error}
        </p>
      )}
    </main>
  )
}
