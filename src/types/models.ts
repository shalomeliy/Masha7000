// Data schemas from docs/input/02-technical-spec.md, section 3.

export interface Role {
  id: string
  name: string // e.g. "טפסן", "חשמלאי"
}

// Not in the spec: a separate list from roles, e.g. "אנטנה עד גובה 20 מטר", "חשמלאי מוסמך".
export interface Certification {
  id: string
  name: string
}

export interface Constraint {
  id: string
  date: string // YYYY-MM-DD
  reason: string
}

// The spec's single `name` is split into first and last name; the contact fields are the user's list.
export interface Worker {
  id: string
  firstName: string
  lastName: string
  birthDate?: string // YYYY-MM-DD
  address?: string
  mobilePhone?: string
  homePhone?: string
  emergencyPhone1?: string
  emergencyPhone2?: string
  roleIds: string[] // independent of each other: any combination is allowed
  certificationIds: string[]
  notes?: string
  constraints: Constraint[]
}

export interface ShiftDefinition {
  id: string
  name: string // "יום", "לילה"
  isStandby?: boolean // standby shift staffed by exactly 3 people
  requiredHeadcount?: number // usually 1 for a regular shift, 3 for standby
  requiredRoleIds: string[]
  requiredCertificationIds: string[]
  startTime: string // "07:00"
  endTime: string // "16:00"
  endsNextDay?: boolean // night job: starts in the morning, ends 16:00 the next day
}

export interface ShiftAssignment {
  id: string
  date: string // YYYY-MM-DD
  shiftDefinitionId: string
  assignedWorkerIds: string[]
  status: 'VALID' | 'HAS_CONFLICT' | 'MISSING_ROLE'
}

// Stored in Drive appDataFolder as settings.json. Not in the spec; holds ids we must remember.
export interface AppSettings {
  calendarId?: string
}
