import { AuthExpiredError, OfflineError } from '../google/auth'
import { ConflictError } from '../google/drive'

export const isAuthExpired = (e: unknown): e is AuthExpiredError => e instanceof AuthExpiredError

/** Plain-Hebrew message for a failed Drive call. */
export function driveErrorText(e: unknown, action: 'load' | 'save'): string {
  if (e instanceof OfflineError) return 'אין חיבור לאינטרנט. כשהחיבור יחזור, נסה שוב.'
  if (e instanceof ConflictError)
    return 'מישהו אחר שמר שינוי ברשימה הזו בינתיים. טענו את הגרסה החדשה, בצע את השינוי שוב.'
  if (isAuthExpired(e)) {
    if (e.reason === 'owner-disconnected') return 'החיבור לדרייב של המנהל נותק. המנהל צריך להתחבר מחדש.'
    if (e.reason === 'not-allowed') return 'המייל שלך כבר לא ברשימת המורשים. בקש מהמנהל להוסיף אותו.'
    if (e.reason === 'no-session') return 'החיבור במכשיר הזה נגמר. צריך להתחבר שוב.'
    return 'החיבור לגוגל פג (זה קורה בערך כל שעה). צריך להתחבר שוב.'
  }
  return action === 'load' ? 'לא הצלחנו לקרוא את הנתונים מגוגל דרייב.' : 'השמירה בגוגל דרייב נכשלה. השינוי לא נשמר, נסה שוב.'
}
