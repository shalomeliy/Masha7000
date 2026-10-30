# Spec: Backup and restore of all app data (v0.6 candidate)

Status: draft (2026-10-30). User decisions: automatic weekly copies, last 8 kept; no password on the downloaded file, a warning instead. No expert fan-out yet. `SECURITY TRIGGERED`: restore reads a file from outside the app (external input) and the backup holds personal data; the `security-expert` must review before the plan.

## Context and observed problem

- All data lives as JSON files in the Drive appDataFolder (`DRIVE_FILES` in `src/lib/google/config.ts`): workers, lists, shifts, waiting jobs, words. The folder is hidden: the manager cannot see, copy or restore it from Google Drive.
- One wrong save (a bug, a deleted worker, a bad paste) or a Google account problem loses data with no way back. A user who deletes the app's access in Google settings can erase the hidden folder.
- The shared-data work (`docs/specs/long-lived-sign-in.md`) moves everyone onto the owner's Drive, so one bad save now hits everyone. A backup gets more important, not less.

## Target user and decision

The manager (the owner), now and then, and once after something went wrong.

## Outcome

The manager can keep a copy of everything outside the app, and can bring the app back to that copy in a few taps, knowing what will be replaced before it happens.

## Goal

- Settings > "גיבוי": "הורדת גיבוי" downloads one file with every list.
- "שחזור מגיבוי": pick a backup file, see what is in it, confirm, and the app's data becomes that copy.
- An automatic weekly copy kept inside the app's own Drive folder (last 8 weeks), so a restore is possible even if the manager never downloaded one. (Open decision 1.)

## Non-goals

- Merging a backup with today's data (restore replaces everything; a merge is a different, much harder feature).
- Restoring one list alone. (Possible later.)
- Backup of the Google Calendar.

## Assumptions

- The backup file is JSON: `{ app: "masha7000", version, createdAt, files: { "workers.json": [...], ... } }`. `settings.json` (calendar id) and the connection check file are left out.
- File name `masha7000-backup-2026-10-30.json`.
- A restore writes each file in turn. If a write fails halfway, the app says which lists were restored and keeps the downloaded file, so the restore can be run again.

## Proposed experience

1. Settings: a "גיבוי" card. Shows "גיבוי אוטומטי אחרון: יום חמישי 29.10" when automatic copies are on.
2. "הורדת גיבוי": the file downloads; a line under the button: "הקובץ מכיל טלפונים וכתובות של עובדים. שמור אותו במקום פרטי."
3. "שחזור מגיבוי": file picker. After reading: "גיבוי מ-29.10.2026: 18 עובדים, 412 משמרות, 6 משימות לשיבוץ". A red button "החלף את כל המידע בגיבוי הזה" and "ביטול".
4. Before replacing, the app first writes an automatic copy of today's data, so even a wrong restore can be undone ("שחזור לפני השחזור").
5. Automatic copies: a list of the last 8 with date and counts, each with "שחזור".

## System and data implications

- New Drive files in the same appDataFolder: `backups/2026-10-29.json` style (8 kept, older ones deleted). Drive appDataFolder allows this with the current scope.
- Size: a year of data is about 2 to 5 MB (estimate from the shared-data spec); 8 copies stay far below the free quota.
- Restore validation: the file must have the app marker, a known version, and each list must pass the same normalizers the app reads with (`normalizeWorker`, `normalizeShiftRecord`, ...). Anything else is refused with "הקובץ הזה אינו גיבוי של האפליקציה" and nothing is written.
- After a restore, every list is reloaded from Drive.
- With shared data, a restore must use the same "file changed since read" check as any save.

## Acceptance criteria

1. "הורדת גיבוי" gives a file that, restored into an empty account, shows the same workers, shifts, waiting jobs, lists and words.
2. A non-JSON file, a JSON of another app, or a file with a broken list is refused and nothing changes.
3. The preview counts match the file's content.
4. "ביטול" after the preview changes nothing.
5. Before a restore writes anything, a copy of today's data is saved, and it appears in the automatic list.
6. A Drive error in the middle of a restore shows which lists were restored and offers "נסה שוב".
7. A weekly copy is made on the first app open of each week (Sunday to Saturday); never more than one a week; never more than 8 kept.
8. The download and the restore work on Android Chrome and iPhone Safari (installed app included).

## Security and privacy

- The backup holds names, phones, addresses, birth dates, notes and constraint texts. It is created only by a tap and never sent anywhere by the app.
- Restore treats the file as untrusted: parse as JSON only, size limit (for example 20 MB), shape check per list, no text from it is run or rendered as HTML.
- Open for `security-expert`: is a plain (unencrypted) download acceptable for this data, or should the file be protected with a password?

## Verification

Unit tests for building, validating and reading the backup; a round trip test; browser check of download and restore with mocked Drive.

## Open decisions (the user's)

1. Automatic weekly copies inside Drive: yes or no? Recommendation: yes, it protects against the most likely failure (a bad save) with no effort from the manager.
2. Password on the downloaded file? Recommendation: no for now, a clear warning instead; a password is easy to lose and then the backup is useless.
3. Who may restore once others can sign in: only the owner, or everyone allowed? Recommendation: only the owner.
