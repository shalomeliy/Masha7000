import { constraintCodeOf } from '../lib/constraintForm'
import { ConstraintForm } from '../pages/ConstraintForm'
import { render } from '../boot'

// The workers' weekly constraints form, opened from WhatsApp: only the form, never the sign-in.
const code = constraintCodeOf(window.location.pathname)
if (code) render(<ConstraintForm code={code} />, { installable: false })
else await import('./app')
