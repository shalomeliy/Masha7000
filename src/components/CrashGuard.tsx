import { Component, type ReactNode } from 'react'
import { tx } from '../i18n'
import { reportError } from '../lib/monitoring'
import { isStaleDownload, reloadOnceForStaleDownload } from './crashGuardRules'

// A screen that throws while drawing shows this message in its place, instead of a blank page for
// the whole app. The error goes to the error monitoring. A part of the app that failed to download
// because a newer version was published meanwhile reloads the page once, quietly.

interface State {
  error: unknown
}

export class CrashGuard extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error }
  }

  componentDidCatch(error: unknown) {
    if (isStaleDownload(error) && reloadOnceForStaleDownload()) return
    reportError(error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <section role="alert" className="mx-4 mt-6 space-y-3 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-100">
        <h2 className="text-lg font-bold">{tx('משהו השתבש במסך הזה')}</h2>
        <p className="text-sm text-red-200">{tx('המידע שלך שמור בגוגל דרייב. טעינה מחדש בדרך כלל פותרת את זה.')}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => window.location.reload()} className="min-h-11 rounded-xl bg-red-500/80 px-4 font-semibold text-white">
            {tx('טען מחדש')}
          </button>
          <button type="button" onClick={() => this.setState({ error: null })} className="min-h-11 rounded-xl border border-red-400/50 px-4 font-semibold">
            {tx('נסה שוב')}
          </button>
        </div>
      </section>
    )
  }
}
