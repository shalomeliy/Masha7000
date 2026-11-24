import { expect, test, type Page } from '@playwright/test'

// Smart onboarding on the fake Drive: a brand-new team gets the wizard; its answers hide what it does
// not use (vehicles here), and Settings > מסכים ותכונות turns a feature back on. A team with data never sees it.

async function openFresh(page: Page) {
  await page.goto('/')
  await page.evaluate(() => {
    sessionStorage.clear()
    localStorage.setItem('dev.mockDrive', '1')
    localStorage.setItem('dev.mockDrive.empty', '1')
  })
  await page.reload()
}

const tab = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name, exact: true })
const answer = (page: Page, label: string) => page.getByRole('button', { name: label, exact: true }).click()

test('a new team answers the wizard, and vehicles it said no to are gone', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openFresh(page)
  await expect(page.getByRole('heading', { name: /ברוך הבא/ })).toBeVisible()
  await page.getByLabel('איך קוראים לעסק?').fill('E2E בע"מ')
  await page.getByRole('button', { name: 'מתחילים' }).click()
  await answer(page, 'תחזוקה וטכנאים')
  await answer(page, 'עד 10')
  await answer(page, 'רק עבודות יום (עד 16:00)')
  await answer(page, 'כן, עם תאריך תוקף')
  await answer(page, 'לא') // vehicles
  await answer(page, 'לא') // departments
  await answer(page, 'אומרים לי, ואני רושם')
  await answer(page, 'לא, אני מקליד')
  await answer(page, 'כן') // closing
  await answer(page, 'כן') // Shali
  await page.getByRole('button', { name: 'אין, המשך' }).click()
  await expect(page.getByRole('heading', { name: 'זה מה שיופיע לך' })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'רכבים' })).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByRole('switch', { name: 'עבודות לילה' })).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('button', { name: 'סיום, בוא נתחיל' }).click()

  await tab(page, 'הגדרות').click()
  await expect(page.getByRole('button', { name: /^רכבים/ })).toHaveCount(0)
  await page.getByRole('button', { name: /^מסכים ותכונות/ }).click()
  await page.getByRole('button', { name: /^מסכים ותכונות/ }).first().click()
  await page.getByRole('switch', { name: 'רכבים' }).click()
  await expect(page.getByRole('switch', { name: 'רכבים' })).toHaveAttribute('aria-checked', 'true')
  await tab(page, 'הגדרות').click()
  await expect(page.getByRole('button', { name: /^רכבים/ })).toBeVisible()

  // Answered once: a reload goes straight to the app.
  await page.reload()
  await expect(page.getByRole('navigation')).toBeVisible()
  await expect(page.getByRole('heading', { name: /ברוך הבא/ })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('a team with data never sees the wizard', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    sessionStorage.clear()
    localStorage.removeItem('dev.mockDrive.empty')
    localStorage.setItem('dev.mockDrive', '1')
  })
  await page.reload()
  await expect(page.getByRole('navigation')).toBeVisible()
  await expect(page.getByRole('heading', { name: /ברוך הבא/ })).toHaveCount(0)
})
