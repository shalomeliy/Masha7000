# Spec: Monthly report per worker (v0.6 candidate)

Status: draft (2026-10-30). User decisions: a postponed night job counts as worked; weekend = Friday and Saturday only. No expert fan-out yet. `SECURITY NOT TRIGGERED` for the screen; a CSV download leaves the app with workers' names, see "Privacy".

## Context and observed problem

- Every shift ever saved is kept (`src/lib/archive.ts`: shifts are never pruned), with its crew, type, urgency and crew swaps. The archive screen lists shifts, but nowhere adds them up per worker.
- The manager needs the totals for the end of the month (salary input, night allowance) and to answer "why did he get more nights than me?" with numbers.

## Target user and decision

The manager, at the end of a month, checking who worked what and sending it on.

## Outcome

In under a minute the manager has, for any month, a table of every worker's shifts by kind, and can send it.

## Goal

- A "דוח חודשי" view (inside the ארכיון tab, as a second mode next to the shift list).
- Pick a month (default: the previous month while today is before the 5th, else the current month).
- One row per worker: day shifts, night jobs, urgent shifts, weekend shifts (Friday and Saturday), total; tap a row to see that worker's shifts in the archive list.
- Share as WhatsApp text and download as a CSV file that opens in Excel with Hebrew intact.

## Non-goals

- Hours and pay. The app has no hours by design (a day shift ends 16:00, a night job 16:00 the next day).
- Editing shifts from the report.
- Per-place or per-job-type reports (possible later on the same screen).

## Assumptions

- A shift counts in the month of its start date (a night job of the 31st counts in that month).
- A worker counts for a shift when they are in its final crew. A worker swapped out (`swaps`) is not counted, and is shown in a separate "הוחלף" column so nothing is hidden.
- A shift that was postponed (closure "postponed") still counts as worked: the crew went out. (Open decision 1.)
- Urgent shifts are also counted as day or night by their type; "urgent" is an extra column, not a separate bucket, so the total is day + night.
- Workers with no shifts in the month are listed at the bottom with zeros, so a missing worker is visible.

## Proposed experience

1. ארכיון tab: a two-option switch at the top, "משמרות" (today's list) and "דוח חודשי".
2. Month picker: "‹ אוקטובר 2026 ›".
3. Table, sticky first column with the worker name: יום · לילה · דחופות · סופ"ש · סה"כ · הוחלף. Sorted by total, highest first. A totals row at the bottom.
4. Buttons: "שליחה בוואטסאפ" (text table, same look as today's week text) and "הורדה לאקסל" (CSV).
5. Tap a worker: switches to "משמרות" with that worker and month already filtered.

## System and data implications

- No new Drive files. Computed from `shifts`, `workers`, `shiftDefinitions`, which the archive already loads.
- CSV: UTF-8 with BOM so Excel shows Hebrew; file name `masha7000-2026-10.csv`.
- Deleted workers: a shift may hold a worker id that no longer exists; shown as "עובד שנמחק" so totals still add up.

## Acceptance criteria

1. A worker with 12 day shifts and 3 night jobs in October shows 12, 3, total 15.
2. A night job dated 31.10 counts in October, not November.
3. A worker swapped out of a shift is not counted in it and shows 1 in "הוחלף"; the worker who replaced them is counted.
4. An urgent night shift counts in "לילה" and in "דחופות", and the total counts it once.
5. A shift on Friday or Saturday counts in "סופ"ש".
6. The bottom row equals the sum of every column.
7. The CSV opens in Excel with Hebrew names readable and the same numbers as the screen.
8. A month with no shifts shows "אין משמרות בחודש הזה".

## Privacy

The CSV and WhatsApp text contain workers' names and work days. They leave the app only when the manager taps the button; nothing is sent by itself. No phone numbers or addresses are included.

## Verification

Unit tests for every counting rule above; a CSV round trip test; browser check on phone width (the table must not scroll the whole page sideways, only inside itself).

## Open decisions (the user's)

1. Postponed night job: count it as worked? Recommendation: yes, the crew went out.
2. Weekend: Friday and Saturday by the shift's start date, or also holiday eves? Recommendation: Friday and Saturday now; holidays later if needed.
3. Is a separate night count enough for the night allowance, or does the payroll need another split?
