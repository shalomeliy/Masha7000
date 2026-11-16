// Error monitoring (Sentry, free tier). Only in the built app and only when VITE_SENTRY_DSN is set.
// Sentry's code is downloaded after the page is up, so it never slows the first screen; errors that
// happen before it arrives are kept and sent once it is ready.
// Privacy: no personal details (sendDefaultPii off), no session replay, no console lines (they may
// hold worker names), and the text of an error is cut to its first 300 characters. Addresses lose
// their query and hash (the workers' form links carry a form code and an editing token there).

type Pending = { error: unknown }
type Message = { text: string; log: string; done: (id: string | null) => void }

/** An address without its query and hash, and with a form code in its path hidden:
 * `/c?c=abc&t=xyz#x` -> `/c`, `/join/AbC123xyz` -> `/join/:code`. Anything else is left alone. */
export const stripQuery = (v: unknown) =>
  typeof v === 'string' ? v.replace(/[?#].*$/s, '').replace(/\/(join|constraints)\/[\w-]+/g, '/$1/:code') : v

// Errors React caught on a screen (CrashGuard): they never reach the window, so they are handed over here.
let send: ((error: unknown) => void) | null = null
let waiting: Pending[] | null = null
let sendMessage: ((m: Message) => void) | null = null
let waitingMessages: Message[] = []

/**
 * Sends a report the person asked to send (the voice log), with a long text attached. Resolves with its
 * Sentry id, or null when there is no monitoring here (local, no DSN, blocked) within 8 s.
 */
export function reportMessage(text: string, log: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false
    const done = (id: string | null) => {
      if (settled) return
      settled = true
      resolve(id)
    }
    if (!import.meta.env.PROD || !DSN) return done(null)
    if (sendMessage) sendMessage({ text, log, done })
    else waitingMessages.push({ text, log, done })
    setTimeout(() => done(null), 8000)
  })
}

/** Sends an error the app caught itself to the monitoring (nothing without a DSN). */
export function reportError(error: unknown): void {
  if (send) send(error)
  else waiting?.push({ error })
}

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined

export function startMonitoring(): void {
  if (!import.meta.env.PROD || !DSN) return
  const early: Pending[] = []
  waiting = early
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
          release: (import.meta.env.VITE_RELEASE as string) || undefined, // the Vercel commit
          sendDefaultPii: false,
          // Speed as real phones feel it (LCP, INP, CLS): one page-load measurement per opening.
          // No tracing headers go to any server (Google's APIs would refuse an unknown header).
          tracesSampleRate: 1,
          tracePropagationTargets: [],
          integrations: (defaults) => [
            ...defaults.filter((i) => i.name !== 'Breadcrumbs'),
            Sentry.breadcrumbsIntegration({ console: false, dom: true, fetch: true, history: true, xhr: true }),
            Sentry.browserTracingIntegration({ instrumentNavigation: false, enableLongTask: false }),
          ],
          beforeBreadcrumb(crumb) {
            if (crumb.data) for (const k of ['url', 'from', 'to']) if (k in crumb.data) crumb.data[k] = stripQuery(crumb.data[k])
            return crumb
          },
          beforeSend(event) {
            if (event.request?.url) event.request.url = stripQuery(event.request.url) as string
            if (event.request) delete event.request.query_string
            for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = ex.value.slice(0, 300)
            if (event.message) event.message = event.message.slice(0, 300)
            return event
          },
          beforeSendTransaction(event) {
            if (event.transaction) event.transaction = stripQuery(event.transaction) as string
            if (event.request?.url) event.request.url = stripQuery(event.request.url) as string
            if (event.request) delete event.request.query_string
            for (const span of event.spans ?? []) {
              span.description = stripQuery(span.description) as string | undefined
              if (span.data) for (const k of ['url', 'http.url', 'url.full']) if (k in span.data) span.data[k] = stripQuery(span.data[k]) as string
            }
            return event
          },
        })
        window.removeEventListener('error', onError)
        window.removeEventListener('unhandledrejection', onRejection)
        send = (error) => Sentry.captureException(error)
        sendMessage = (m) => m.done(Sentry.captureMessage(m.text, { level: 'info', extra: { log: m.log } }) || null)
        waiting = null
        for (const m of waitingMessages) sendMessage(m)
        waitingMessages = []
        for (const p of early) Sentry.captureException(p.error)
      })
      .catch(() => {}) // monitoring must never break the app (blocked by an ad blocker, offline)

  if (document.readyState === 'complete') setTimeout(load, 2000)
  else window.addEventListener('load', () => setTimeout(load, 2000), { once: true })
}
