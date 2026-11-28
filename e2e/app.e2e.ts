import { expect, test, type Page } from '@playwright/test'

// The manager's app on the fake Drive: every tab opens, nothing crashes, and opening the app lists
// Drive once instead of searching for every file.

async function openWithFakeDrive(page: Page) {
  await page.goto('/')
  await page.evaluate(() => {
    sessionStorage.clear()
    localStorage.setItem('dev.mockDrive', '1')
  })
  await page.reload()
  await page.getByRole('navigation').waitFor()
}

// On a cold dev server Vite pre-bundles a package the first time a screen needs it, and the old copy
// of that screen then fails to download; the app reloads once (CrashGuard), as it does after a new
// version in production. A navigation that lands on that reload is simply tried again.
async function reopen(page: Page) {
  await page.waitForLoadState('networkidle')
  try {
    await page.goto('/')
  } catch {
    await page.goto('/')
  }
}

const tab = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name, exact: true })

// The vehicles list lives in Settings since 2026-11-20 (its bottom button became "יומן אישי").
async function openVehicles(page: Page) {
  await tab(page, 'הגדרות').click()
  await page.getByRole('button', { name: /^רכבים/ }).click()
  await expect(page.getByRole('heading', { name: 'רכבים' })).toBeVisible()
}

test('every tab opens without the crash message', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openWithFakeDrive(page)

  await tab(page, 'יומן').click()
  await expect(page.getByRole('heading', { name: 'יומן עבודות' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'עבודה דחופה עכשיו' })).toBeVisible()

  await tab(page, 'עובדים').click()
  await expect(page.getByRole('heading', { name: 'עובדים' })).toBeVisible()
  await expect(page.getByText('דני לוי')).toBeVisible()

  await tab(page, 'יומן אישי').click()
  await expect(page.getByRole('heading', { name: 'יומן אישי' })).toBeVisible()

  await openVehicles(page)

  await tab(page, 'הגדרות').click()
  await expect(page.getByRole('heading', { name: 'הגדרות' })).toBeVisible()

  await expect(page.getByText('משהו השתבש במסך הזה')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('opening the calendar lists Drive once, not one search per file', async ({ page }) => {
  const searches: string[] = []
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (u.hostname === 'www.googleapis.com' && u.pathname === '/drive/v3/files' && r.method() === 'GET') searches.push(u.searchParams.get('q') ?? '')
  })
  await openWithFakeDrive(page)
  await tab(page, 'יומן').click()
  await expect(page.getByRole('heading', { name: 'יומן עבודות' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'עבודה דחופה עכשיו' })).toBeVisible()
  // Before: one search per list (about 16) and per month of shifts.
  expect(searches.filter((q) => q.includes("name = '")).length).toBe(0)
  expect(searches.length).toBeLessThanOrEqual(3)
})

test('a saved vehicle is still there after a reload', async ({ page }) => {
  await openWithFakeDrive(page)
  await openVehicles(page)
  await page.getByRole('button', { name: 'הוספת רכב' }).first().click()
  await page.getByLabel('מספר רישוי').fill('12-345-67')
  await page.getByLabel('דגם').fill('E2E טנדר')
  await page.getByRole('button', { name: 'שמירה' }).click()
  await expect(page.getByText('E2E טנדר')).toBeVisible()

  await reopen(page)
  await openVehicles(page)
  await expect(page.getByText('E2E טנדר')).toBeVisible()
})

test('a personal log entry needs start and end times, and stays after a reload', async ({ page }) => {
  await openWithFakeDrive(page)
  await tab(page, 'יומן אישי').click()
  await page.getByRole('button', { name: 'הוספת רישום' }).first().click()
  await page.getByLabel('מה עשיתי').fill('E2E סיור בערד')
  await page.getByRole('button', { name: 'שמירה' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'צריך למלא שעת התחלה' })).toBeVisible()
  await page.getByLabel('שעת התחלה').fill('08:30')
  await page.getByRole('button', { name: 'שמירה' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'צריך למלא שעת סיום' })).toBeVisible()
  await page.getByLabel('שעת סיום').fill('12:00')
  await page.getByRole('button', { name: 'שמירה' }).click()
  // The saved entry in the list (the closing form may still hold the same words for a moment).
  const saved = page.getByRole('listitem').getByText('E2E סיור בערד')
  await expect(saved).toBeVisible()
  await expect(page.getByRole('listitem').getByText('08:30–12:00')).toBeVisible()

  await reopen(page)
  await tab(page, 'יומן אישי').click()
  await expect(saved).toBeVisible()
})

test('dictating "שעת התחלה ... שעת סיום ... בערב" fills the time fields while still listening', async ({ page }) => {
  // A stand-in for the phone's speech recognition: says one sentence and keeps listening (never ends).
  await page.addInitScript(() => {
    class FakeRecognition {
      lang = ''
      interimResults = false
      continuous = false
      onresult: ((e: unknown) => void) | null = null
      onerror = null
      onend = null
      start() {
        setTimeout(() => this.onresult?.({ results: [[{ transcript: 'שעת התחלה 8:30 שעת סיום 5:30 בערב התקנו שתי תרנים בערד' }]] }), 50)
      }
      stop() {}
    }
    const w = globalThis as unknown as { SpeechRecognition: unknown; webkitSpeechRecognition: unknown }
    w.SpeechRecognition = FakeRecognition
    w.webkitSpeechRecognition = FakeRecognition
  })
  await openWithFakeDrive(page)
  await tab(page, 'יומן אישי').click()
  await page.getByRole('button', { name: 'הוספת רישום' }).first().click()
  await page.getByRole('button', { name: 'הקראה' }).click()
  await expect(page.getByLabel('שעת התחלה')).toHaveValue('08:30')
  await expect(page.getByLabel('שעת סיום')).toHaveValue('17:30')
  await expect(page.getByLabel('מה עשיתי')).toHaveValue('התקנו שתי תרנים בערד')
  await page.getByRole('button', { name: 'שמירה' }).click()
  await expect(page.getByText('08:30–17:30')).toBeVisible()
})

test("a job picks its vehicle from the app's own list: make, model, plate, mark on the right", async ({ page }) => {
  await openWithFakeDrive(page)
  await openVehicles(page)
  for (const [plate, model, make] of [['55-555-55', 'Caddy', 'Volkswagen'], ['11-111-11', 'D-Max', 'Isuzu']]) {
    await page.getByRole('button', { name: 'הוספת רכב' }).first().click()
    await page.getByLabel('מספר רישוי').fill(plate)
    await page.getByLabel('דגם').fill(model)
    await page.getByLabel('יצרן').fill(make)
    await page.getByRole('button', { name: 'שמירה' }).click()
    await expect(page.getByText(plate)).toBeVisible()
  }
  await tab(page, 'יומן').click()
  await page.getByRole('button', { name: 'עבודה חדשה' }).first().click()
  await page.getByRole('button', { name: /^רכב /, exact: false }).first().click()
  const items = page.getByRole('option')
  await expect(items).toHaveText(['בלי', 'Isuzu ‏·‏ D-Max ‏·‏ 11-111-11', 'Volkswagen ‏·‏ Caddy ‏·‏ 55-555-55'])
  // The round mark is on the right of the text, as the rest of the Hebrew screen.
  const row = await items.nth(1).boundingBox()
  const mark = await items.nth(1).locator('span').first().boundingBox()
  expect(mark!.x).toBeGreaterThan(row!.x + row!.width / 2)
  await items.nth(2).click()
  await expect(page.getByRole('option')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Volkswagen/ })).toBeVisible()
})

// The user, 2026-11-23: a look at another tab in the middle of a conversation must not lose it.
// A long press (1 second) on the Shali button, on another screen: Shali listens and answers there,
// in a small card, and the screen stays (owner, 2026-11-26). The browser's listening is a stand-in here.
test('a long press on Shali listens and answers without leaving the screen', async ({ page }) => {
  await page.addInitScript(() => {
    class FakeRecognition {
      lang = ''
      interimResults = false
      continuous = false
      onresult: ((e: unknown) => void) | null = null
      onerror: ((e: unknown) => void) | null = null
      onend: (() => void) | null = null
      start() {
        setTimeout(() => {
          this.onresult?.({ results: [[{ transcript: 'יוסי חולה מחר' }]] })
          this.onend?.()
        }, 200)
      }
      stop() {}
    }
    ;(globalThis as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition
  })
  await openWithFakeDrive(page)
  await tab(page, 'יומן').click()
  const shali = page.getByRole('navigation').getByRole('button').nth(2)
  // A short tap still opens the Shali screen; this one is held.
  await shali.hover()
  await page.mouse.down()
  await page.waitForTimeout(1300)
  await page.mouse.up()
  const card = page.getByRole('dialog', { name: 'Shali' })
  await expect(card.getByRole('status').filter({ hasText: 'לאשר, או לתקן?' })).toBeVisible()
  await expect(tab(page, 'יומן')).toHaveAttribute('aria-current', 'page')
  await card.getByRole('button', { name: 'אשר' }).click()
  await expect(card.getByRole('button', { name: 'אשר' })).toBeHidden()
  await expect(tab(page, 'יומן')).toHaveAttribute('aria-current', 'page')
})

// Since 2026-11-28 (owner): an open conversation follows the manager to other screens in the small card.
test('a conversation with Shali waits while another tab is looked at', async ({ page }) => {
  await openWithFakeDrive(page)
  await page.getByRole('button', { name: 'הקלדה' }).click()
  await page.getByPlaceholder('אפשר גם להקליד').fill('יוסי חולה מחר')
  await page.getByRole('button', { name: 'שלח' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'לאשר, או לתקן?' })).toBeVisible()
  await tab(page, 'יומן').click()
  const card = page.getByRole('dialog', { name: 'Shali' })
  await expect(card.getByRole('button', { name: 'אשר' })).toBeVisible()
  await tab(page, 'עובדים').click()
  await expect(card.getByRole('button', { name: 'אשר' })).toBeVisible()
  // The center button (Shali) has no text name of its own.
  await page.getByRole('navigation').getByRole('button').nth(2).click()
  await expect(card).toBeHidden()
  await expect(page.getByRole('status').filter({ hasText: 'לאשר, או לתקן?' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'אשר' })).toBeVisible()
})
