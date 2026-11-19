import { expect, test, type Page } from '@playwright/test'

// What both app stores require (docs/specs/mobile-store-apps.md): a yes before anything goes to an
// outside AI, and deleting the account from inside the app. On the fake Drive, with the assistant's
// free stand-in (never the paid one).

async function openWithFakeDrive(page: Page) {
  await page.goto('/')
  await page.evaluate(() => {
    sessionStorage.clear()
    localStorage.clear()
    localStorage.setItem('dev.mockDrive', '1')
  })
  await page.reload()
  await page.getByRole('navigation').waitFor()
}

const tab = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name, exact: true })

test('Shali asks before the first request goes to Claude, and "not now" sends nothing', async ({ page }) => {
  const asked: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/assistant') asked.push(r.url())
  })
  await openWithFakeDrive(page)
  await tab(page, 'Shali').click()
  await page.getByRole('button', { name: 'הקלדה' }).click()
  const say = async (text: string) => {
    await page.getByPlaceholder('אפשר גם להקליד').fill(text)
    await page.getByRole('button', { name: 'שלח', exact: true }).click()
  }

  await say('תכתוב לי שיר על משמרות לילה')
  const card = page.getByRole('dialog', { name: 'לפני ש-Shali שולח מידע החוצה' })
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'לא עכשיו' }).click()
  await expect(page.getByText('בלי האישור שלך Shali עושה רק את מה שהוא יודע לבד, בלי Claude.')).toBeVisible()
  expect(asked).toEqual([])

  await say('תכתוב לי שיר על משמרות לילה')
  await card.getByRole('button', { name: 'מסכים' }).click()
  await expect.poll(() => asked.length).toBeGreaterThan(0)

  // Settings shows the yes and takes it back.
  await tab(page, 'הגדרות').click()
  await page.getByRole('button', { name: /החשבון שלי/ }).click()
  await page.getByRole('button', { name: 'ביטול האישור' }).click()
  await expect(page.getByText(/^לא אישרת\./)).toBeVisible()
})

test('deleting the account wipes the app data and keeps the language', async ({ page }) => {
  await openWithFakeDrive(page)
  // A file of the app in the fake Drive, to see it go.
  await page.evaluate(() => {
    const files = JSON.parse(sessionStorage.getItem('dev.mockDrive.files') ?? '[]') as unknown[]
    files.push(['sentinel.json', { id: 'id-sentinel', name: 'sentinel.json', body: '{}', version: 1 }])
    sessionStorage.setItem('dev.mockDrive.files', JSON.stringify(files))
    localStorage.setItem('shiftsmart.aiConsent', JSON.stringify({ v: 1 }))
    localStorage.setItem('app.language', 'he')
  })
  await page.reload()
  await tab(page, 'הגדרות').click()
  await page.getByRole('button', { name: /החשבון שלי/ }).click()
  await page.getByRole('button', { name: 'מחיקת החשבון שלי' }).click()
  const go = page.getByRole('button', { name: 'כן, למחוק לצמיתות' })
  await expect(go).toBeDisabled()
  await page.getByLabel('כדי לאשר, כתוב: מחק').fill('מחק')
  await go.click()
  // The app reloads at the start; the fake Drive then sets up its sample files again.
  await page.waitForLoadState('load')
  await page.getByRole('navigation').waitFor()
  await page.waitForLoadState('networkidle')
  const left = await page.evaluate(() => ({
    files: sessionStorage.getItem('dev.mockDrive.files') ?? '',
    consent: localStorage.getItem('shiftsmart.aiConsent'),
    language: localStorage.getItem('app.language'),
  }))
  expect(left.files).not.toContain('sentinel.json')
  expect(left.consent).toBeNull()
  expect(left.language).toBe('he')
})
