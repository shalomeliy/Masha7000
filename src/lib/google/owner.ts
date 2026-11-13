import { tx } from '../../i18n'
// The owner's controls on the server: who may sign in, and disconnecting the owner's Drive.

export interface AccessList {
  owner: string
  emails: string[]
  /** Of those, the ones the voice assistant is open to. */
  assistant?: string[]
}

const REASONS: Record<string, string> = {
  'bad-email': tx('זו לא כתובת מייל תקינה.'),
  'owner-implicit': tx('זה המייל שלך, הוא תמיד מורשה.'),
  'not-owner': tx('רק המנהל יכול לשנות את הרשימה.'),
  'no-session': tx('החיבור במכשיר הזה נגמר. צריך להתחבר שוב.'),
}

async function call<T>(body: object): Promise<T> {
  let res: Response
  try {
    res = await fetch('/api/owner', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error(tx('אין חיבור לאינטרנט.'))
  }
  const data = (await res.json().catch(() => ({}))) as T & { reason?: string }
  if (!res.ok) throw new Error(REASONS[data.reason ?? ''] ?? tx('השרת לא הצליח. נסה שוב.'))
  return data
}

export const listAccess = () => call<AccessList>({ action: 'list' })
export const addAccess = (email: string) => call<AccessList>({ action: 'add', email })
export const removeAccess = (email: string) => call<AccessList>({ action: 'remove', email })
export const setAssistant = (email: string, on: boolean) => call<AccessList>({ action: 'assistant', email, on })
export const disconnectDrive = () => call<{ ok: true }>({ action: 'disconnect' })
