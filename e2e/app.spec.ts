import { expect, test, type Page } from '@playwright/test'

const admin = { email: 'admin@example.com', password: 'password123' }

async function login(page: Page) {
  await page.goto('/')
  await page.getByLabel(/email|אימייל/i).fill(admin.email)
  await page.getByLabel(/password|סיסמה/i).fill(admin.password)
  await page.getByRole('button', { name: /sign in|כניסה/i }).click()
  await expect(page.getByRole('heading', { name: /our groceries|הקניות שלנו/i })).toBeVisible()
}

test('primary buttons use the intended foreground color', async ({ page }) => {
  await page.goto('/')
  const signIn = page.getByRole('button', { name: /sign in|כניסה/i })
  const colors = await signIn.evaluate((button) => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--primary-foreground)'
    document.body.append(probe)
    const result = {
      actual: getComputedStyle(button).color,
      expected: getComputedStyle(probe).color
    }
    probe.remove()
    return result
  })
  expect(colors.actual).toBe(colors.expected)
})

test('rejects invalid login with visible feedback', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel(/email|אימייל/i).fill('nobody@example.com')
  await page.getByLabel(/password|סיסמה/i).fill('wrong-password')
  await page.getByRole('button', { name: /sign in|כניסה/i }).click()
  await expect(page.getByRole('alert')).toBeVisible()
})

test('creates, filters, edits, changes quantity, and deletes a product', async ({ page }) => {
  await login(page)
  const name = `Oat milk ${Date.now()}`
  const search = page.getByRole('textbox', { name: /find or add|חיפוש או/i })
  const inputWidth = await search.evaluate((input) => input.getBoundingClientRect().width)
  await search.fill('temporary filter')
  await expect
    .poll(() => search.evaluate((input) => input.getBoundingClientRect().width))
    .toBe(inputWidth)
  expect(
    await page.locator('.search-shell').evaluate((shell) => shell.scrollWidth <= shell.clientWidth)
  ).toBe(true)
  await page.getByRole('button', { name: /clear search|ניקוי החיפוש/i }).click()
  await expect(search).toHaveValue('')
  await expect(page.getByRole('button', { name: /clear search|ניקוי החיפוש/i })).toHaveCount(0)
  await search.fill(name)
  await page.getByRole('button', { name: new RegExp(name, 'i') }).click()
  await expect(page.getByText(name, { exact: true })).toBeVisible()
  const productRow = page.locator('.product-row').filter({ hasText: name })
  const rowBox = await productRow.boundingBox()
  if (!rowBox) throw new Error('Product row is not visible')
  const swipeDirection = (await page.locator('html').getAttribute('dir')) === 'rtl' ? 1 : -1
  await page.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    rowBox.x + rowBox.width / 2 + swipeDirection * 24,
    rowBox.y + rowBox.height / 2,
    { steps: 4 }
  )
  await page.mouse.up()
  await expect
    .poll(() =>
      productRow.evaluate((row) => {
        const transform = getComputedStyle(row).transform
        return transform === 'none' ? 0 : Math.round(new DOMMatrix(transform).m41)
      })
    )
    .toBe(0)
  const closeDrawer = page.getByRole('button', { name: /^close$|^סגירה$/i })
  if (await closeDrawer.isVisible().catch(() => false)) await closeDrawer.click()
  await search.fill(name.slice(0, -1))
  await page.getByRole('button', { name: new RegExp(`edit ${name}`, 'i') }).click()
  const audit = page.locator('.product-audit')
  await expect(audit.locator('time')).toBeVisible()
  await expect(audit.locator('.audit-user')).toBeVisible()
  expect(await audit.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(42)
  await page.getByRole('spinbutton', { name: /^quantity$|^כמות$/i }).fill('2.25')
  await page.getByRole('button', { name: /save changes|שמירת שינויים/i }).click()
  await expect(productRow.getByRole('button', { name: /^quantity:|^כמות:/i })).toContainText('2.25')
  await page.getByRole('button', { name: new RegExp(`edit ${name}`, 'i') }).click()
  await page.getByRole('button', { name: /^delete$|^מחיקה$/i }).click()
  await page
    .getByRole('button', { name: /^delete$|^מחיקה$/i })
    .last()
    .click()
  await expect(page.getByText(name, { exact: true })).toHaveCount(0)
})

test('switches direction and persists language', async ({ page }) => {
  await login(page)
  const before = await page.locator('html').getAttribute('dir')
  await page.locator('.language-button').click()
  await expect(page.locator('html')).not.toHaveAttribute('dir', before ?? '')
  await page.reload()
  await expect(page.locator('html')).not.toHaveAttribute('dir', before ?? '')
})
