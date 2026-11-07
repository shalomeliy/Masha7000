import { initLanguage } from './i18n'

// The picked language's words are loaded first: the app's modules read their texts as they load.
await initLanguage()
await import('./boot')
