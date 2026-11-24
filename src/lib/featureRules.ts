// The features that change the rules of "שבץ" and its advice (src/lib/features.ts), as plain values the
// pure planning code can read. App sets them from the team's settings (applyFeatureRules); tests and
// a team from before the wizard keep everything on. Turning one off never changes saved data:
// certifications stay on the jobs and workers, they only stop counting.
// `hours` / `restHours`: the team checks shifts by hours (settings.shiftHours); off = whole days, as before.
export const featureRules = { certs: true, certExpiry: true, constraints: true, hours: false, restHours: 0 }

export const DEFAULT_REST_HOURS = 8

export function applyFeatureRules(
  flags: { certs: boolean; certExpiry: boolean; constraints: boolean },
  shiftHours?: { on: boolean; restHours: number },
) {
  featureRules.certs = flags.certs
  featureRules.certExpiry = flags.certExpiry
  featureRules.constraints = flags.constraints
  featureRules.hours = !!shiftHours?.on
  featureRules.restHours = shiftHours?.on ? Math.max(0, shiftHours.restHours || 0) : 0
}
