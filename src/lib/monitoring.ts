// Error monitoring (Sentry, free tier). Only in the built app and only when VITE_SENTRY_DSN is set.
// Sentry's code is downloaded after the page is up, so it never slows the first screen; errors that
// happen before it arrives are kept and sent once it is ready.
// Privacy: no personal details (sendDefaultPii off), no session replay, no console lines (they may
// hold worker names), and the text of an error is cut to its first 300 characters.

type Pending = { error: unknown }

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined

export function startMonitoring(): void {
  if (!import.meta.env.PROD || !DSN) return
  const early: Pending[] = []
  const onError = (e: ErrorEvent) => early.push({ error: e.error ?? e.message })
  const onRejection = (e: PromiseRejectionEvent) => early.push({ error: e.reason })
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)

  const load = () =>
    import('@sentry/browser')
      .then((Sentry) => {
        Sentry.init({
          dsn: DSN,
          environment: import.meta.env.MODE,
          release: import.meta.env.VITE_RELEASE as string | undefined,
          sendDefaultPii: false,
          tracesSampleRate: 0,
          integrations: (defaults) => [
            ...defaults.filter((i) => i.name !== 'Breadcrumbs'),
            Sentry.breadcrumbsIntegration({ console: false, dom: true, fetch: true, history: true, xhr: true }),
          ],
          beforeSend(event) {
            for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = ex.value.slice(0, 300)
            if (event.message) event.message = event.message.slice(0, 300)
            return event
          },
        })
        window.removeEventListener('error', onError)
        window.removeEventListener('unhandledrejection', onRejection)
        for (const p of early) Sentry.captureException(p.error)
      })
      .catch(() => {}) // monitoring must never break the app (blocked by an ad blocker, offline)

  if (document.readyState === 'complete') setTimeout(load, 2000)
  else window.addEventListener('load', () => setTimeout(load, 2000), { once: true })
}
