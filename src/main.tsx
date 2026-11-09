import { initLanguage } from './i18n'
import { startMonitoring } from './lib/monitoring'

// Error monitoring first, so an error while the app starts is caught too (it does nothing without a DSN).
startMonitoring()

// The picked language's words are loaded first: the app's modules read their texts as they load.
await initLanguage()
await import('./boot')
