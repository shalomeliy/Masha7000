# Spec: Workers, roles and shift types (v0.2)

Short spec, written directly from `docs/input/01-product-ux-spec.md` (section 2.2, 2.3) and `02-technical-spec.md` (sections 2, 3). Expert fan-out skipped on purpose: the coordinator asked for a brief spec, and every building block (Drive JSON read/write, the UI shell) is already proven in v0.1.

## Update from the user (2026-10-28)

The user replaced the generic examples with their real organization. These win over anything below:

- Shifts: no morning/afternoon/evening, and no hour editing for now (user: hours do not matter yet). A shift ends at 16:00, either the same day ("יום") or the next day ("לילה", the night job). Stored as `endsNextDay` plus fixed 07:00/16:00 times for the calendar later. This replaces criterion 5 below.
- Roles: טפסן, חשמלאי, טכנאי אנטנות, טכנאי מצלמות, כללי. A worker can hold any combination.
- New list, certifications (`certifications.json`): אנטנה עד גובה 20 מטר, אנטנה בגובה 40 מטר, אנטנה מעל 40 מטר, חשמלאי מוסמך, מהנדס חשמל. Managed exactly like roles; shift types can require them too.
- Worker fields: first name, last name, birth date, address, mobile, home phone, emergency phone 1 and 2, roles, certifications, notes. Only first name is required. Workers saved in the older single-`name` format are split on read.
- Filter on the workers list: pick roles and/or certifications, see only workers holding all of them ("I give you the role and/or certification, you find the relevant workers").

## Context

The app can sign in and talk to Google, but has no real data yet. Every later feature (schedule, gap analysis, constraints) needs three lists first: the roles in the organization, the workers and the roles each is certified for, and the shift types with their required roles.

## Target user and decision

The manager, alone (phase 1). The decision this screen supports: "who can do which job, and what does each shift need".

## Goal

- Manage the global list of roles (add, rename, delete).
- Manage workers: name, phone (optional), notes (optional), certified roles.
- Manage shift types: name, start and end time (overnight allowed), headcount, required roles, standby flag (standby defaults to 3 people).
- Everything is saved in the manager's Drive appDataFolder in the three files named by the technical spec, and is there after reload and on another device.

## Non-goals

- Constraints (`Worker.constraints` stays an empty list; edited in a later version).
- Assigning workers to dates, the calendar, gap analysis.
- Per-role headcount inside a shift (one list of required roles plus one total headcount, as in the spec schema).

## Assumptions (to confirm with the user)

- Starter shift types offered as one button on an empty list: בוקר 07:00-15:00, ערב 15:00-23:00, לילה 23:00-07:00, כוננות 24 שעות 07:00-07:00 with 3 people. Nothing is written until the manager presses it.
- Worker "details" from the UX spec = phone and free-text notes.

## Experience

The "עובדים" tab gets three sections switched by a segmented control at the top: עובדים / תפקידים / משמרות. Each is a list of cards with an add button. Tapping a card opens an edit sheet from the bottom (one-handed use) with save, cancel and delete. Delete asks for confirmation. Deleting a role that is in use says how many workers and shifts use it, and removes it from them.

## Data

- `roles_definition.json`: `Role[]`
- `workers.json`: `Worker[]` (adds optional `phone`, `notes` to the spec schema)
- `shift_definitions.json`: `ShiftDefinition[]`

A missing file means an empty list. Each change writes the whole affected file (a few KB at most). Saves to one file run one after another, and the edit sheet cannot be closed while a save is in flight, so a failed save always shows its error.

## Acceptance criteria

1. Adding a role shows it in the list immediately and it is still there after a page reload.
2. A role name cannot be empty or duplicate an existing name (case and surrounding spaces ignored); the save button explains why.
3. A worker can be created with a name only; roles are chosen from the role list with toggles. Worker names need not be unique (two workers may share a first name).
4. A worker card shows the worker's role names.
5. A shift type with end time earlier than start time is shown as ending "למחרת".
6. Marking a shift as standby sets headcount to 3 (editable afterwards). Headcount is at least 1.
7. Deleting a role used by N workers and M shifts warns with those numbers and, on confirm, removes the role from all of them.
8. When Drive is unreachable: loading shows a spinner, a failed load shows an error with "נסה שוב", a failed save shows an error and the list returns to the last saved state.
9. When the Google session expired, the user is told to sign in again instead of a raw error.

## States

Loading (per list), empty (explanation + add button, plus the starter button for shifts), error with retry, saving (button disabled).

## Accessibility and privacy

Hebrew RTL, touch targets at least 44px, labels on every field, dialogs focus the first field and close with Escape. Worker names and phones live only in the manager's own Drive appDataFolder.

## Verification

Unit tests for the pure list logic (validation, cascade delete, overnight detection). Manual check in the running app against a real Drive: add, reload, edit, delete.
