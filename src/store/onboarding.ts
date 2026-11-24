import { create } from 'zustand'

// "לענות שוב על השאלות" in Settings opens the wizard on top of the app.
export const useOnboarding = create<{ forced: boolean; open: () => void; close: () => void }>((set) => ({
  forced: false,
  open: () => set({ forced: true }),
  close: () => set({ forced: false }),
}))
