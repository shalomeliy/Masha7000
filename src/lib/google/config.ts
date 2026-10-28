export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

// Least privilege: appdata = only this app's hidden Drive folder;
// calendar.app.created = only calendars this app creates (Smart Shifts) and their events.
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/calendar.app.created',
].join(' ')

export const SHIFTS_CALENDAR_NAME = 'Smart Shifts'
export const TIME_ZONE = 'Asia/Jerusalem'

export const DRIVE_FILES = {
  workers: 'workers.json',
  roles: 'roles_definition.json',
  certifications: 'certifications.json',
  shiftDefinitions: 'shift_definitions.json',
  shifts: 'shifts.json',
  pendingJobs: 'pending_jobs.json',
  postponeReasons: 'postpone_reasons.json',
  settings: 'settings.json',
} as const
