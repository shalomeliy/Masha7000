import { googleFetch } from './auth'
import { readJson, writeJson } from './drive'
import { DRIVE_FILES, SHIFTS_CALENDAR_NAME, TIME_ZONE } from './config'
import type { AppSettings } from '../../types/models'

const CAL_API = 'https://www.googleapis.com/calendar/v3'

export interface CalendarEvent {
  id?: string
  summary: string
  description?: string // assignment metadata as JSON (spec section 2)
  start: { dateTime: string; timeZone?: string }
  end: { dateTime: string; timeZone?: string }
}

/**
 * Returns the id of the "Smart Shifts" calendar, creating it on first use.
 * The id is remembered in Drive settings.json, because the calendar.app.created
 * scope cannot list the user's other calendars to find it by name.
 */
export async function ensureShiftsCalendar(): Promise<string> {
  const settings = (await readJson<AppSettings>(DRIVE_FILES.settings)) ?? {}
  if (settings.calendarId) {
    try {
      await googleFetch(`${CAL_API}/calendars/${encodeURIComponent(settings.calendarId)}`)
      return settings.calendarId
    } catch {
      // The calendar was deleted by the user; create a new one below.
    }
  }
  const res = await googleFetch(`${CAL_API}/calendars`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: SHIFTS_CALENDAR_NAME, timeZone: TIME_ZONE }),
  })
  const created: { id: string } = await res.json()
  await writeJson(DRIVE_FILES.settings, { ...settings, calendarId: created.id })
  return created.id
}

export async function listEvents(calendarId: string, timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const res = await googleFetch(`${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`)
    const data: { items: CalendarEvent[]; nextPageToken?: string } = await res.json()
    events.push(...data.items)
    pageToken = data.nextPageToken
  } while (pageToken)
  return events
}

export async function upsertEvent(calendarId: string, event: CalendarEvent): Promise<CalendarEvent> {
  const base = `${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events`
  const res = await googleFetch(event.id ? `${base}/${encodeURIComponent(event.id)}` : base, {
    method: event.id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })
  return res.json()
}

export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  await googleFetch(
    `${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE' },
  )
}
