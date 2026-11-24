import { tx } from '../../i18n'
// The owner's controls on the server: who may sign in, and disconnecting the owner's Drive.

export interface AccessList {
  owner: string
  emails: string[]
  /** Of those, the ones the voice assistant is open to. */
  assistant?: string[]
  /** Of those, the ones whose Shali may also ask Claude (the owner's budget). */
  claude?: string[]
}

/** A customer team's own list (its owner signed in): his managers, up to his plan. */
export interface TeamAccessList {
  owner: string
  emails: string[]
  maxManagers: number
  customer: true
  claude: boolean
}

/** A new customer waiting for the app owner's answer. */
export interface AccessRequest {
  email: string
  businessName: string
  whatsapp: string
  at: string
}

/** An approved customer: his own team, on his own Drive. */
export interface CustomerTeam {
  id: string
  owner: string
  businessName: string
  whatsapp: string
  maxManagers: number
  claude: boolean
  createdAt: string
  managers: string[]
}

export interface Customers {
  requests: AccessRequest[]
  teams: CustomerTeam[]
}

/** The plans: how many managers a customer may have, himself included. */
export const PLAN_LIMITS = [1, 10, 30] as const

const REASONS: Record<string, string> = {
  'bad-email': tx('זו לא כתובת מייל תקינה.'),
  'owner-implicit': tx('זה המייל שלך, הוא תמיד מורשה.'),
  'not-owner': tx('רק המנהל יכול לשנות את הרשימה.'),
  'no-session': tx('החיבור במכשיר הזה נגמר. צריך להתחבר שוב.'),
  'other-team': tx('המייל הזה כבר שייך לצוות אחר. מייל אחד יכול להיות רק בצוות אחד.'),
  'team-full': tx('הגעת למספר המנהלים של המנוי שלך.'),
  'not-found': tx('הלקוח הזה כבר לא קיים.'),
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
export const setAssistantClaude = (email: string, on: boolean) => call<AccessList>({ action: 'assistant-claude', email, on })
export const disconnectDrive = () => call<{ ok: true }>({ action: 'disconnect' })

// A customer team's owner: his own managers (the server knows his team from his session).
export const listTeamAccess = () => call<TeamAccessList>({ action: 'list' })
export const addTeamAccess = (email: string) => call<TeamAccessList>({ action: 'add', email })
export const removeTeamAccess = (email: string) => call<TeamAccessList>({ action: 'remove', email })

// The app owner: new customers.
export const loadCustomers = () => call<Customers>({ action: 'requests' })
export const approveCustomer = (email: string, maxManagers: number) => call<Customers>({ action: 'approve', email, maxManagers })
export const rejectCustomer = (email: string) => call<Customers>({ action: 'reject', email })
export const setCustomerClaude = (id: string, on: boolean) => call<Customers>({ action: 'team-claude', id, on })
export const setCustomerLimit = (id: string, maxManagers: number) => call<Customers>({ action: 'team-limit', id, maxManagers })
export const removeCustomer = (id: string) => call<Customers>({ action: 'team-remove', id })

/** One line of the server's security log (api/_lib/audit.ts). */
export interface AuditEntry {
  at: string
  event: string
  email?: string
  target?: string
  ip?: string
}
export const loadAudit = () => call<{ entries: AuditEntry[] }>({ action: 'audit' })
