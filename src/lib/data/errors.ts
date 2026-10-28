import { AuthExpiredError } from '../google/auth'

export const isAuthExpired = (e: unknown) => e instanceof AuthExpiredError

/** Plain-Hebrew message for a failed Drive call. */
export function driveErrorText(e: unknown, action: 'load' | 'save'): string {
  if (isAuthExpired(e)) return 'החיבור לגוגל פג (זה קורה בערך כל שעה). צריך להתחבר שוב.'
  return action === 'load' ? 'לא הצלחנו לקרוא את הנתונים מגוגל דרייב.' : 'השמירה בגוגל דרייב נכשלה. השינוי לא נשמר, נסה שוב.'
}
