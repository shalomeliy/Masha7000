// Is the outside API on for this team? The server's copy of src/lib/features.ts resolveFeatures for
// the one feature 'api' (api/ cannot import src/; src/lib/apiNormalize.test.ts keeps them equal).
// A team that turned "גישת API" off in Settings > מסכים ותכונות no longer sees its keys there, so the
// keys must stop working too: a hidden key that still opens the Drive is a door nobody watches.
// Nothing is deleted: turning it on again brings the same keys back.

interface Settings {
  features?: Record<string, unknown>
  onboarding?: { answers?: Record<string, unknown> }
}

export function apiFeatureOn(settings: unknown): boolean {
  const s = settings && typeof settings === 'object' ? (settings as Settings) : null
  if (!s?.onboarding) return true // a team from before the wizard (the owner's): everything on
  const saved = s.features?.api
  const switchOnly = !Object.keys(s.onboarding.answers ?? {}).length
  return saved === true || (switchOnly && saved === undefined)
}
