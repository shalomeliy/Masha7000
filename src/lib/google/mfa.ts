// Two-step sign-in on the server (/api/mfa): after Google, a 6-digit code from an authenticator app.

const REASONS: Record<string, string> = {
  'wrong-code': 'הקוד לא נכון. בדוק שהקלדת את 6 הספרות שמופיעות עכשיו באפליקציה, ונסה שוב.',
  'too-many': 'יותר מדי ניסיונות. חכה רבע שעה ונסה שוב.',
  'setup-expired': 'עבר יותר מדי זמן מההכנה. לחץ "התחלה מחדש" ונסה שוב.',
  enrolled: 'האימות כבר הוגדר לחשבון הזה. הקלד קוד מהאפליקציה.',
  'not-enrolled': 'האימות עוד לא הוגדר לחשבון הזה.',
  'no-session': 'החיבור במכשיר הזה נגמר. צריך להתחבר שוב.',
  'not-allowed': 'המייל הזה לא מורשה להיכנס.',
  'not-owner': 'רק המנהל יכול לאפס אימות של מישהו אחר.',
}

async function call<T>(body: object): Promise<T> {
  let res: Response
  try {
    res = await fetch('/api/mfa', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('אין חיבור לאינטרנט.')
  }
  const data = (await res.json().catch(() => ({}))) as T & { reason?: string }
  if (!res.ok) throw new Error(REASONS[data.reason ?? ''] ?? 'השרת לא הצליח. נסה שוב.')
  return data
}

export const startSetup = () => call<{ secret: string; uri: string }>({ action: 'setup' })
export const enableMfa = (code: string) => call<{ recoveryCodes: string[] }>({ action: 'enable', code })
export const verifyMfa = (code: string) => call<{ recoveryLeft: number }>({ action: 'verify', code })
export const mfaStatus = () => call<{ enrolled: boolean; recoveryLeft: number }>({ action: 'status' })
export const newRecoveryCodes = () => call<{ recoveryCodes: string[] }>({ action: 'codes' })
export const logoutEverywhere = () => call<{ ok: true }>({ action: 'logout-all' })
export const resetMfaOf = (email: string) => call<{ ok: true }>({ action: 'reset', email })

/** Groups of 4 so a person can copy the secret by hand. */
export const spaced = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim()
