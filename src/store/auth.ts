import { create } from 'zustand'
import { getAccessToken, signIn, signOut } from '../lib/google/auth'

interface AuthState {
  signedIn: boolean
  busy: boolean
  error: string | null
  login: () => Promise<void>
  logout: () => void
}

export const useAuth = create<AuthState>((set) => ({
  // A token saved before a reload is still good: skip the sign-in screen.
  signedIn: getAccessToken() !== null,
  busy: false,
  error: null,
  login: async () => {
    set({ busy: true, error: null })
    try {
      await signIn()
      set({ signedIn: true, busy: false })
    } catch (e) {
      set({ busy: false, error: (e as Error).message })
    }
  },
  logout: () => {
    signOut()
    set({ signedIn: false })
  },
}))
