import { authMode, rememberedAccount } from '../lib/google/auth'
import { GOOGLE_CLIENT_ID } from '../lib/google/config'
import { useAuth } from '../store/auth'

// What came back from Google, in plain words (?signin=... from the server).
const NOTICES: Record<string, string> = {
  'not-allowed': 'המייל הזה לא מורשה להיכנס. בקש מהמנהל להוסיף אותו בהגדרות.',
  'not-owner': 'רק המנהל יכול לחבר את הדרייב. התחבר עם המייל של המנהל.',
  cancelled: 'ההתחברות בוטלה.',
  scopes: 'צריך לסמן את כל ההרשאות (דרייב ויומן) כדי שכולם יוכלו לעבוד על הנתונים. נסה שוב.',
  failed: 'ההתחברות לא הצליחה. נסה שוב.',
}

export function SignIn() {
  const { status, who, notice, login, reconnect, busy, error } = useAuth()
  const server = authMode() === 'server'
  const account = rememberedAccount()
  const ownerGone = status === 'ownerDisconnected'

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-3xl font-bold">ShiftSmart</h1>
        <p className="mt-2 text-slate-400">
          סידור עבודה 24/7, כוננות ואילוצי עובדים.{' '}
          {server ? 'הנתונים נשמרים בגוגל דרייב של המנהל.' : 'הנתונים נשמרים בחשבון הגוגל שלך בלבד.'}
        </p>
      </div>

      {!GOOGLE_CLIENT_ID && (
        <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          חסר מזהה התחברות של גוגל. יש להעתיק את <code>.env.example</code> ל-<code>.env.local</code> ולמלא אותו.
        </p>
      )}

      {ownerGone && (
        <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          {who?.isOwner
            ? 'הדרייב שלך לא מחובר לאפליקציה. לחיצה אחת מחברת אותו, ואז כולם עובדים על הנתונים שלך.'
            : 'הדרייב של המנהל לא מחובר כרגע. המנהל צריך להתחבר, ואז אפשר להמשיך.'}
        </p>
      )}
      {status === 'notAllowed' && (
        <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          {who?.email ? `${who.email}: ` : ''}
          {NOTICES['not-allowed']}
        </p>
      )}
      {status === 'failed' && (
        <p role="alert" className="text-sm text-red-400">
          השרת לא ענה. נסה שוב בעוד רגע.
        </p>
      )}
      {notice && NOTICES[notice] && (
        <p role="alert" className="text-sm text-amber-200">
          {NOTICES[notice]}
        </p>
      )}

      {ownerGone && who?.isOwner ? (
        <button
          type="button"
          onClick={reconnect}
          disabled={busy}
          className="rounded-xl bg-sky-500 py-4 text-lg font-semibold text-slate-950 disabled:opacity-50"
        >
          {busy ? 'מתחבר...' : 'חיבור מחדש'}
        </button>
      ) : (
        <button
          type="button"
          onClick={login}
          disabled={busy || !GOOGLE_CLIENT_ID || (ownerGone && !who?.isOwner)}
          className="rounded-xl bg-sky-500 py-4 text-lg font-semibold text-slate-950 disabled:opacity-50"
        >
          {busy ? 'מתחבר...' : status === 'notAllowed' ? 'כניסה עם מייל אחר' : account ? 'המשך' : 'התחברות עם Google'}
        </button>
      )}

      {!ownerGone && !busy && (
        <p className="text-sm text-slate-400">
          {server
            ? 'מתחברים פעם אחת בכל מכשיר, והחיבור נשמר.'
            : account
              ? `${account.email ? `תמשיך כ-${account.email}. ` : ''}החיבור לגוגל מתחדש כל שעה, לחיצה אחת מחדשת אותו.`
              : ''}
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
