# Spec: Shift records, closing a job, urgent shift (v0.3)

Short spec from the user's messages (2026-10-28). No expert fan-out: the building blocks (Drive lists, sheets, tag lists) are proven in v0.2; the one new risk, Hebrew dictation, is covered by `docs/spikes/hebrew-dictation.md`.

## From the user

- Every shift has a date, a location, the nature of the work, and a list of workers, each with the role they fill in that shift.
- After a night job the manager closes it: done fully (closed), done partially (free text or Hebrew voice), or postponed (a reason from a list the manager edits, e.g. "חסר אישור קונסטרוקטור", "תנאי מזג אויר", plus free text or voice).
- The manager can open a shift "from now" at any moment, including Friday and Saturday, and the weekly planning must take those shifts into account.

## Goal

- The "יומן" tab becomes a real list of shifts (by date), with "משמרת חדשה" and a prominent "משמרת דחופה עכשיו".
- Each shift can be closed with one of three outcomes, and the outcome shows on the card.
- Postpone reasons are a manager-edited list, like roles and certifications.

## Non-goals

- The automatic weekly planner and gap analysis (later version). This version keeps urgent shifts as data the planner will read, and shows the manager, while picking a crew, how many shifts each worker already has this week.
- Writing shifts to Google Calendar.

## Data

- `shifts.json`: `ShiftRecord[]`
  - `id`, `date` (YYYY-MM-DD), `shiftDefinitionId` (יום / לילה, decides if it ends the next day)
  - `location`, `jobDescription` (text)
  - `crew: { workerId, roleId }[]` (the role must be one the worker holds)
  - `urgent?: true`, `startedAt?` (ISO time the urgent shift was opened)
  - `closure?: { outcome: 'done' | 'partial' | 'postponed', note?, reasonId?, closedAt }`
- `postpone_reasons.json`: `{ id, name }[]`, starter list: חסר אישור קונסטרוקטור, תנאי מזג אויר.

## Experience

- Shift list grouped by day, current week first; urgent shifts marked "דחופה". A card shows date, shift type, location, job, crew names with role, and its closure state.
- "משמרת דחופה עכשיו": opens the editor with today's date and the current time already set, works any day of the week.
- Crew picker: choose a worker, then one of their roles. Next to each worker: "כבר X משמרות השבוע" (week = Sunday to Saturday), so urgent shifts count.
- "סגירת עבודה" on a shift: three big choices. Partial: text field with mic. Postponed: pick reasons (one or more) plus optional text with mic. Done: one tap. Closure can be changed later.

## Acceptance criteria

1. A shift needs a date, a shift type, and a location or job description; crew is optional.
2. Urgent shift opened on Saturday at 22:10 is saved with that date and time and shows "דחופה".
3. Crew role must be one of the worker's roles; the same worker cannot be in one shift twice.
4. Week count for a worker counts every shift (urgent or not) dated Sunday to Saturday of that week.
5. Closing "postponed" requires at least one reason or a note. "Partial" requires a note.
6. Mic button appears only where the browser supports speech; dictated text is added to what was typed, never replaces it.
7. Drive failures behave like v0.2 (spinner, error with retry, rollback).

## Verification

Unit tests for the pure rules (validation, week count, closure rules). Browser check with mocked Drive, like v0.2.

## Added by the user during v0.3

- Tap-to-call: a dial link on the worker card (mobile) and next to each of the four phone fields in the editor. Done.
- Dates: every date in the app uses `DateField` (`src/components/DateField.tsx`). A tap opens the calendar (`showPicker`); a typed date is checked against the calendar on blur (impossible dates like 31.2, half-typed dates, out-of-range dates) and the form refuses to save it. Done for birth date; every new date field must use it.

## Decisions after review (v0.3)

- The data model in code supersedes the "Data" section above: `closure.reasonIds[]`, urgent `startTime` / `endDate` / `endTime`, `PendingJob.scheduledShiftId`.
- Closing only for night jobs (night type or urgent), and only once the shift's date has come.
- A scheduled job is kept in `pending_jobs.json` with `scheduledShiftId`; "לשיבוץ" shows a job until it sits in an existing shift. Cancelling that shift brings it back; re-closing the original job does not.
- Every list card shows a pencil: tap to edit, delete is inside the editor (user request).
- Partial has two paths (user, 2026-10-28): reopen the same task (back to "לשיבוץ" as it was), or close it and open a follow-up task with what is left (`closure.followUp`, `PendingJob.followUp`). Follow-ups chain without limit through `fromShiftId` / `fromJobId`; "לשיבוץ" shows the chain (`taskHistory`) and the calendar marks a shift that continues an earlier task.
