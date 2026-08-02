import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { identityFixturePath, type E2eIdentityFixture } from './global-setup'

function readFixture() {
  return JSON.parse(readFileSync(identityFixturePath, 'utf8')) as E2eIdentityFixture
}

function creatorForVerifiedTest(projectName: string, retry: number) {
  const fixture = readFixture()
  const identityKey = `${projectName}-verified-${retry}`
  const identity = fixture.identities[identityKey]
  if (!identity) throw new Error(`No local E2E identity for ${identityKey}`)
  return identity
}

function identityForInviteTest(projectName: string, role: 'admin' | 'invitee', retry: number) {
  const fixture = readFixture()
  const identityKey =
    role === 'admin' ? `${projectName}-invite-admin-${retry}` : `${projectName}-invitee-${retry}`
  const identity = fixture.identities[identityKey]
  if (!identity) throw new Error(`No local E2E identity for ${identityKey}`)
  return identity
}

test('offers sign in or create household and explains the shared list', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: /sign in|כניסה/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /create household|יצירת משק בית/i })).toBeVisible()

  await page.getByRole('button', { name: /create household|יצירת משק בית/i }).click()
  await expect(
    page.getByRole('heading', { name: /shared list for your household|רשימה משותפת/i })
  ).toBeVisible()
  await expect(page.getByText('You will be the household admin.')).toBeVisible()
})

test('requires email confirmation before the trial creation screen', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /create household|יצירת משק בית/i }).click()
  await page.getByRole('button', { name: /create my account|יצירת החשבון שלי/i }).click()
  const suffix = `${test.info().project.name}-${Date.now()}`
  const fixture = readFixture()
  await page.getByRole('textbox', { name: /name|שם/i }).fill(`New Creator ${suffix}`)
  await page
    .getByRole('textbox', { name: /email|אימייל/i })
    .fill(`${fixture.prefix}-signup-${suffix}@example.com`)
  await page.locator('input[type="password"]').fill('password123')
  await page.getByRole('button', { name: /create account|יצירת חשבון/i }).click()

  await expect(
    page.getByRole('heading', { name: /confirm your email|אישור האימייל/i })
  ).toBeVisible()
  await expect(page.getByText(/not created yet|עדיין לא נוצרו/i)).toBeVisible()
  await expect(
    page.getByRole('button', { name: /create household and start trial|יצירת משק הבית/i })
  ).toHaveCount(0)
})

test('a verified unassigned account can explicitly create its household and trial', async ({
  page
}) => {
  await page.goto('/')
  const creator = creatorForVerifiedTest(test.info().project.name, test.info().retry)
  await page.getByLabel(/email|אימייל/i).fill(creator.email)
  await page.locator('input[type="password"]').fill(creator.password)
  await page.getByRole('button', { name: /sign in|כניסה/i }).click()
  await expect(page.getByRole('heading', { name: /start your free trial|להתחיל/i })).toBeVisible()
  await page
    .getByRole('button', { name: /create household and start trial|יצירת משק הבית/i })
    .click()
  await expect(
    page.getByRole('heading', { name: /your household is ready|משק הבית מוכן/i })
  ).toBeVisible()
  await page.getByRole('button', { name: /continue to list|המשך לרשימה/i }).click()
  await expect(
    page.getByRole('textbox', { name: /find or add a product|חיפוש או הוספת מוצר/i })
  ).toBeVisible()
})

test('invite URLs bypass household creation', async ({ page }) => {
  await page.goto('/invite/example-token')
  await expect(page.getByRole('button', { name: /sign in|כניסה/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /create household|יצירת משק בית/i })).toHaveCount(0)
})

test('an invitee can request access and be approved by the household admin', async ({
  page,
  browser
}) => {
  const retry = test.info().retry
  const projectName = test.info().project.name
  const admin = identityForInviteTest(projectName, 'admin', retry)
  const invitee = identityForInviteTest(projectName, 'invitee', retry)

  await page.goto('/')
  await page.getByLabel(/email|אימייל/i).fill(admin.email)
  await page.locator('input[type="password"]').fill(admin.password)
  await page.getByRole('button', { name: /sign in|כניסה/i }).click()
  await expect(page.getByRole('heading', { name: /start your free trial|להתחיל/i })).toBeVisible()
  await page
    .getByRole('button', { name: /create household and start trial|יצירת משק הבית/i })
    .click()
  await page.getByRole('button', { name: /continue to list|המשך לרשימה/i }).click()
  await expect(
    page.getByRole('textbox', { name: /find or add a product|חיפוש או הוספת מוצר/i })
  ).toBeVisible()
  await page.getByRole('button', { name: /users|משתמשים/i }).click()
  await page
    .getByRole('button', { name: /generate invite|rotate invite|יצירת קישור הזמנה/i })
    .click()
  const inviteUrl = await page
    .getByRole('textbox', { name: /invite a member|הזמנת משתמש/i })
    .inputValue()

  const inviteeContext = await browser.newContext()
  const inviteePage = await inviteeContext.newPage()
  try {
    await inviteePage.goto(inviteUrl)
    await expect(inviteePage.getByText(/approval is required|נדרש אישור/i)).toBeVisible()
    await inviteePage.getByLabel(/email|אימייל/i).fill(invitee.email)
    await inviteePage.locator('input[type="password"]').fill(invitee.password)
    await inviteePage.getByRole('button', { name: /sign in|כניסה/i }).click()
    await inviteePage.getByRole('button', { name: /request access|בקשת גישה/i }).click()
    await expect(
      inviteePage.getByRole('heading', { name: /waiting for approval|ממתינים לאישור/i })
    ).toBeVisible()

    await expect(page.getByText(invitee.email)).toBeVisible()
    await page.getByRole('button', { name: /approve|אישור/i }).click()
    await expect(
      inviteePage.getByRole('textbox', { name: /find or add a product|חיפוש או הוספת מוצר/i })
    ).toBeVisible()
  } finally {
    await inviteeContext.close()
  }
})
