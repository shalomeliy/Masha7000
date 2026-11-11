import { tx } from '../../i18n'

// Settings > "גישת API": the owner's keys for the outside API (api/owner.ts?scope=api-keys, api/v1.ts).

export interface ApiKeyRow {
  id: string
  name: string
  scopes: ('read' | 'write')[]
  personal: boolean
  createdAt: string
  lastUsed: string | null
}

export interface ApiCall {
  at: string
  keyId: string | null
  method: string
  path: string
  status: number
}

const REASONS: Record<string, string> = {
  'no-name': tx('צריך לתת שם למפתח.'),
  'too-many-keys': tx('הגעת ל-20 מפתחות. בטל מפתח שלא בשימוש.'),
  'not-owner': tx('רק המנהל יכול לנהל מפתחות.'),
  'no-session': tx('החיבור במכשיר הזה נגמר. צריך להתחבר שוב.'),
}

async function call<T>(body: object): Promise<T> {
  let res: Response
  try {
    res = await fetch('/api/owner?scope=api-keys', {
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

export const listApiKeys = () => call<{ keys: ApiKeyRow[]; log: ApiCall[] }>({ action: 'list' })
export const createApiKey = (name: string, write: boolean, personal: boolean) =>
  call<{ key: string; record: ApiKeyRow }>({ action: 'create', name, write, personal })
export const revokeApiKey = (id: string) => call<{ ok: boolean }>({ action: 'revoke', id })
