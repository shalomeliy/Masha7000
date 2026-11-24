import { tx } from '../i18n'
import { authMode, isRootTeam, rememberedAccount } from '../lib/google/auth'
import { GOOGLE_CLIENT_ID } from '../lib/google/config'
import { useAuth } from '../store/auth'
import { AccessRequest } from './AccessRequest'

// What came back from Google, in plain words (?signin=... from the server).
const NOTICES: Record<string, string> = {
  'not-allowed': tx('המייל הזה לא מורשה להיכנס. בקש מהמנהל להוסיף אותו בהגדרות, או, אם אתה לקוח חדש, בקש גישה כאן.'),
  'not-owner': tx('רק המנהל יכול לחבר את הדרייב. התחבר עם המייל של המנהל.'),
  cancelled: tx('ההתחברות בוטלה.'),
  scopes: tx('צריך לסמן את כל ההרשאות (דרייב ויומן) כדי שכולם יוכלו לעבוד על הנתונים. נסה שוב.'),
  failed: tx('ההתחברות לא הצליחה. נסה שוב.'),
  'too-many': tx('יותר מדי ניסיונות התחברות. חכה כמה דקות ונסה שוב.'),
}

export function SignIn() {
  const { status, who, notice, login, reconnect, busy, error } = useAuth()
  const server = authMode() === 'server'
  const account = rememberedAccount()
  const ownerGone = status === 'ownerDisconnected'
  // A new customer's owner: his team runs on his own Drive, which he links once (two-step first).
  const customerOwner = ownerGone && who?.isOwner === true && !isRootTeam(who)
  const refused = status === 'notAllowed' || notice === 'not-allowed'

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-3xl font-bold">Shali</h1>
        <p className="mt-2 text-slate-400">
          {tx('סידור עבודה 24/7, כוננות ואילוצי עובדים.{v}{v2}', { v: ' ', v2: server ? tx('הנתונים נשמרים בגוגל דרייב של המנהל.') : tx('הנתונים נשמרים בחשבון הגוגל שלך בלבד.') })}</p>
      </div>

      {!GOOGLE_CLIENT_ID && (
        <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          {tx('חסר מזהה התחברות של גוגל. יש להעתיק את')}{' '}<code>.env.example</code> {tx('ל-')}<code>.env.local</code> {tx('ולמלא אותו.')}
        </p>
      )}

      {ownerGone && (
        <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          {customerOwner
            ? tx('שלב אחרון: חבר את הגוגל דרייב שלך. הנתונים של הצוות שלך נשמרים רק בו, בתיקייה נסתרת של האפליקציה, והיומן ביומן גוגל חדש בשם Smart Shifts. האפליקציה לא רואה שום קובץ אחר שלך.')
            : who?.isOwner
            ? tx('הדרייב שלך לא מחובר לאפליקציה. לחיצה אחת מחברת אותו, ואז כולם עובדים על הנתונים שלך.')
            : tx('הדרייב של המנהל לא מחובר כרגע. המנהל צריך להתחבר, ואז אפשר להמשיך.')}
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
          {tx('השרת לא ענה. נסה שוב בעוד רגע.')}
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
          {busy ? tx('מתחבר...') : customerOwner ? tx('חבר את הגוגל דרייב שלי') : tx('חיבור מחדש')}
        </button>
      ) : (
        <button
          type="button"
          onClick={login}
          disabled={busy || !GOOGLE_CLIENT_ID || (ownerGone && !who?.isOwner)}
          className="rounded-xl bg-sky-500 py-4 text-lg font-semibold text-slate-950 disabled:opacity-50"
        >
          {busy ? tx('מתחבר...') : status === 'notAllowed' ? tx('כניסה עם מייל אחר') : account ? tx('המשך') : tx('התחברות עם Google')}
        </button>
      )}

      {server && refused && <AccessRequest />}
      {server && !refused && !ownerGone && !busy && (
        <button type="button" onClick={login} className="text-sm text-sky-300 underline">
          {tx('לקוח חדש? בקש גישה')}
        </button>
      )}

      {!ownerGone && !busy && (
        <p className="text-sm text-slate-400">
          {server
            ? tx('מתחברים פעם אחת בכל מכשיר, והחיבור נשמר.')
            : account
              ? tx('{v}החיבור לגוגל מתחדש כל שעה, לחיצה אחת מחדשת אותו.', { v: account.email ? tx('תמשיך כ-{email}. ', { email: account.email }) : '' })
              : ''}
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {tx('ההתחברות נכשלה: {error}', { error })}</p>
      )}

      <p className="text-xs text-slate-500">
        {tx('הכניסה היא בכפוף ל')}
        <a href="/terms.html" className="text-sky-300 underline">
          {tx('תנאי השימוש')}
        </a>{' '}
        {tx('ול')}
        <a href="/privacy.html" className="text-sky-300 underline">
          {tx('מדיניות הפרטיות')}
        </a>
        .{' '}
        <a href="/accessibility.html" className="text-sky-300 underline">
          {tx('הצהרת נגישות')}
        </a>
      </p>
    </main>
  )
}
