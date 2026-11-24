// The features that change the rules of "שבץ" and its advice (src/lib/features.ts), as plain values the
// pure planning code can read. App sets them from the team's settings (applyFeatureRules); tests and
// a team from before the wizard keep everything on. Turning one off never changes saved data:
// certifications stay on the jobs and workers, they only stop counting.
export const featureRules = { certs: true, certExpiry: true, constraints: true }

export function applyFeatureRules(flags: { certs: boolean; certExpiry: boolean; constraints: boolean }) {
  featureRules.certs = flags.certs
  featureRules.certExpiry = flags.certExpiry
  featureRules.constraints = flags.constraints
}
