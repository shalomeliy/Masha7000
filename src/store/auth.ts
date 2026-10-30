import { create } from 'zustand'
import { ownerReconnect, resume, signIn, signOut, type Who } from '../lib/google/auth'

export type AuthStatus = 'checking' | 'signedIn' | 'signedOut' | 'notAllowed' | 'ownerDisconnected' | 'failed'

interface AuthState {
  status: AuthStatus
  who: Who | null
  /** Set once from ?signin=... after the server sends the browser back from Google. */
  notice: string | null
  busy: boolean
  error: string | null
  check: () => Promise<void>
  login: () => Promise<void>
  reconnect: () => void
  logout: () => Promise<void>
}

function takeNotice(): string | null {
  const url = new URL(window.location.href)
  const notice = url.searchParams.get('signin')
  if (notice) {
    url.searchParams.delete('signin')
    window.history.replaceState(null, '', url)
  }
  return notice
}

export const useAuth = create<AuthState>((set) => ({
  status: 'checking',
  who: null,
  notice: takeNotice(),
  busy: false,
  error: null,
  check: async () => {
    const r = await resume()
    set({ status: r.status, who: r.who ?? null })
  },
  login: async () => {
    set({ busy: true, error: null, notice: null })
    try {
      await signIn()
      // Popup mode: the server-mode sign-in leaves the page and never gets here.
      set({ status: 'signedIn', busy: false })
    } catch (e) {
      set({ busy: false, error: (e as Error).message })
    }
  },
  reconnect: () => {
    set({ busy: true })
    ownerReconnect()
  },
  logout: async () => {
    await signOut()
    set({ status: 'signedOut', who: null })
  },
}))
