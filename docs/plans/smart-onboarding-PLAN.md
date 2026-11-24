# Plan: smart onboarding, stage 1

Spec: `docs/specs/smart-onboarding.md` (approved 2026-11-24). Spike: `docs/spikes/smart-onboarding.md` (GO).
Status: waiting for the user's approval. Build in a new thread with `loop-engineering`.

## Scope of stage 1

In: feature on/off catalog, the onboarding wizard, Settings > "מסכים ותכונות", "request access" + owner approval, the in-app guide (first chapters), the "request more" field.
Out (later stages, each with its own plan): hourly shifts (own spike on overlap in "שבץ"), customer API keys (security review first), 7-day trial + Grow subscription, shared team (several managers on one Drive).

## Hard constraints found in the code

- **12 function files max** (`api/_lib/functionCount.test.ts`, Vercel Hobby). There are 12 now. No new `api/*.ts` file: new server actions go into existing ones (`api/owner.ts` for approve/reject, `api/join.ts` or `api/feedback.ts` for the public access request).
- Owner = `OWNER_EMAIL`; others sign in only if in `KEYS.allowed` (`api/_lib/session.ts`, `api/auth/callback.ts`).
- Each manager's data is their own Drive appDataFolder; settings live in `settings.json` (`DRIVE_FILES.settings`, type `AppSettings` in `src/types/models.ts`).
- Every new string through `tx()` and translated into all 15 locales (merge on top of HEAD).
- Lists: `ChoiceList`, never native `<select>`.

## Steps (each ends green on `npm run verify`)

### 1. Feature catalog (pure, tested)
- New `src/lib/features.ts`: `FeatureId` union (14 ids from the spec), `NEEDS` dependencies, `ALWAYS_ON` list, `resolveFeatures(settings)` (no `onboarding` record = all on), `answersToFeatures(answers)` (wizard answers -> flags).
- `AppSettings` gets `features?: Partial<Record<FeatureId, boolean>>` and `onboarding?: { version: 1; answers: Record<string, string>; doneAt: string; businessName?: string; whatsapp?: string }`.
- Tests: dependencies, existing manager = all on, each wizard answer maps as in the spec table.

### 2. `useFeatures()` hook
- Reads `settings.json` once with TanStack Query (same cache key everywhere), returns `isOn(id)` and `setFeature(id, on)`.
- Writes merge into the settings file (never overwrite `calendarId`).

### 3. Gate the screens
- Certifications: pass `[]` as known certs to `staffingFor` when off (proven in the spike); hide Settings entry, StaffingField cert pick, WorkKindsSection certs, worker card chips + "+ הוסף הסמכה", CertStars, JoinForm/JoinSection cert fields, worker search by cert.
- Vehicles: Settings panel `vehicles`, `VehiclePick` in ShiftEditor, vehicle text in Calendar/ToSchedule.
- The rest of the 14 (night jobs, departments, constraints + weekly form, join form, job closing + waiting jobs, reports/archive, Shali center button, journal tab, quick lists, API): one gate each at its entry point (BottomNav item, Settings panel, form field).
- Hide only. No data deleted.

### 4. Shali
- `src/lib/freeCommands.ts`: one `isOn` check per intent family (vehicle, cert, constraint, night). A disabled one answers "התכונה כבויה, אפשר להדליק בהגדרות" and does not go to Claude.
- `api/_lib/assistant.ts`: the client sends the list of enabled features; the prompt leaves out disabled ones. Tests on the mock only (`assistantMock.ts`), never the real key.

### 5. Settings > "מסכים ותכונות"
- New `src/pages/settings/FeaturesSection.tsx`: a switch per feature (dependent ones greyed with "צריך קודם: הסמכות"), "לענות שוב על השאלות", and a request field that reuses `FeatureRequestSection` sending.

### 6. Wizard
- New `src/pages/Onboarding.tsx`: one question per screen, tap answers (11 questions from the spec minus the hourly-shifts one, which waits for stage 2: question 3 offers only day / night-until-16:00 for now), summary screen with switches, "חסר לך משהו?" sent through `/api/feedback`.
- Shown once, after sign-in, when the manager is not the owner and `settings.onboarding` is absent. Owner and existing managers (Dolik) never see it: on first load after deploy, a manager who already has data in Drive gets `onboarding: { version: 1, answers: {}, doneAt }` with all on.

### 7. Request access + owner approval
- Sign-in page: "לקוח חדש? בקש גישה". A refused sign-in (`not-allowed`) already knows the Google email; it offers "שלח בקשת גישה" with business name + WhatsApp phone.
- Server: stored sealed in `KEYS.accessRequests` (new key), rate-limited per IP and email, through an existing function file. Email to the owner via Resend (`api/_lib/feedback.ts`).
- Owner: "מי יכול להיכנס" shows pending requests with אשר / דחה (`api/owner.ts` actions `requests`, `approve`, `reject`). Approve = add to `KEYS.allowed`, Shali free-only (Claude off).
- `security-expert` review on this step only (public form + allow-list change).

### 8. In-app guide
- New `src/pages/settings/GuideSection.tsx` + content in `src/lib/guide.ts` (chapters keyed by `FeatureId`, shown only when on), all via `tx()`.
- CLAUDE.md rule: a change that adds or changes behavior updates the guide in the same commit.
- Test: every `FeatureId` and every Settings panel id has a guide chapter (fails when a screen is added without one).

### 9. Translations, e2e, ship
- All new strings into the 15 locale files.
- Playwright (`npm run e2e`, fake Drive): new manager sees the wizard, turns vehicles off, vehicle field gone in a new job; owner never sees the wizard.
- `change-reviewer`, then merge to master (Vercel deploys).

## Risks
- Gating misses a spot and a hidden feature shows up: covered by the e2e and a grep-based test listing the gated components.
- Shali offering a disabled feature: step 4 tests per intent family.
- Function-file limit: step 7 must not add a file; the existing test catches it.

## Size
Roughly 9 build steps, the biggest are 3 (gating) and 7 (access requests). Expect 2-3 sessions.
