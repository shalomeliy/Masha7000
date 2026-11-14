import { joinCodeOf } from '../lib/join'
import { JoinForm } from '../pages/JoinForm'
import { render } from '../boot'

// The workers' details form, opened from WhatsApp: only the form, never the sign-in.
const code = joinCodeOf(window.location.pathname)
if (code) render(<JoinForm code={code} />, { installable: false })
else await import('./app')
