import { tx } from '../i18n'
import { authMode, currentUser, signOut } from './google/auth'
import { deleteShiftsCalendar } from './google/calendar'
import { deleteAllAppFiles } from './google/drive'

// "מחק את החשבון שלי" (App Store 5.1.1(v), Google Play account deletion). Whose data goes:
// - A manager the owner let in: only their access (they work on the owner's Drive, which stays).
// - The owner (or anyone on their own Drive, without the server): the app's files in Drive and the
//   "Smart Shifts" calendar first, with their own token, then everything the server keeps
//   (api/_lib/deleteAccount.ts). Drive first: if it fails, nothing was cut off yet and they can retry.
// Then this device forgets the app (everything it saved but the language) and opens the sign-in screen.

/** True when deleting removes the team's data too, not only this person's access. */
export const deletesTeamData = () => authMode() === 'popup' || currentUser()?.isOwner === true

export async function deleteMyAccount(): Promise<void> {
  if (deletesTeamData()) {
    await deleteShiftsCalendar()
    await deleteAllAppFiles()
  }
  if (authMode() === 'server') {
    let res: Response
    try {
      res = await fetch('/api/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-account' }),
      })
    } catch {
      throw new Error(tx('אין חיבור לאינטרנט.'))
    }
    if (!res.ok) throw new Error(tx('השרת לא הצליח. נסה שוב.'))
  } else {
    await signOut() // gives the Google token back
  }
  forgetDevice()
}

function forgetDevice() {
  try {
    for (const key of Object.keys(localStorage)) if (key !== 'app.language' && !key.startsWith('dev.')) localStorage.removeItem(key)
  } catch {
    // Storage blocked: nothing was kept.
  }
  location.replace('/')
}
