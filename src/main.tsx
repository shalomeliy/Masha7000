import { initLanguage } from './i18n'
import { startMonitoring } from './lib/monitoring'

// Error monitoring first, so an error while the app starts is caught too (it does nothing without a DSN).
startMonitoring()

// The picked language's words are loaded first: the app's modules read their texts as they load.
await initLanguage()

// Local testing with a fake Drive (see src/dev/mockDrive.ts), before any module reads the sign-in. Dropped from the build.
if (import.meta.env.DEV && localStorage.getItem('dev.mockDrive')) await import('./dev/mockDrive')

// Only the code of what this address opens is downloaded, all of it at once: a worker's form from
// WhatsApp does not carry the manager's app, and the manager's app does not carry the forms.
const path = window.location.pathname
if (path.startsWith('/join/')) await import('./entries/join')
else if (path.startsWith('/constraints/')) await import('./entries/constraints')
else await import('./entries/app')
