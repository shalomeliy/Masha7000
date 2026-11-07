# Spike: the code solves, the model only words it (2026-11-07)

**Question:** can a hard staffing problem ("Dani is sick, who replaces him on Sunday in Eilat?") be answered in a few seconds on the cheap model, by letting the app's own planner compute the options and the model only recognize the problem and word the answer?

**Code:** `spikes/solver/solver.live.test.ts` (throwaway). `solveMissing` (about 50 lines on the existing `autoAssign`, `moveShift`): replace the missing worker; else the first day in the next 10 where a full crew fits; else go short. Model calls with effort low: (1) recognize -> tool `solve_missing {shiftId, missingWorkerIds}`; (2) rank the app's options against the saved notes and word them (`advise {spoken, order, notes}`). Same data as the advisor spike (the Eilat job needs one 40m-certified climber; note "יוסי לא עולה לגובה 40 בלי דני לידו").

## Results (two runs)

| step | run 1 | run 2 |
|---|---|---|
| recognize (model) | 4.5 s | 1.2 s |
| solve (code) | 4 ms | 4 ms |
| rank and word (model) | 3.1 s | 3.2 s |
| total, code's own wording | 4.5 s | 1.2 s |
| total, model wording | 7.6 s | 4.4 s |

Before: about 16 s to hear the recommendation (model thinks the whole problem, effort medium).

Options the code found: move to Wednesday 11.11 with Omer (40m) and Avi; or go Sunday short with Yossi only. The model ranked "move" first and added on its own that Yossi does not climb to 40m without Dani (the saved note, which the code cannot read). Both correct.

## Verdict: GO

About 3-4x faster and cheaper (short calls, low effort, fewer output tokens), with answers grounded in the planner's rules instead of the model's guesses. The model's second step still matters: it applies free-text notes the code cannot.

To build: problem kinds beyond "worker missing" (not enough people on a day, a job that cannot be staffed, an overloaded week), each as a solver function; the full advisor stays only as a fallback for what no solver covers. With streaming, the spoken part should be heard in about 3-4 s.
