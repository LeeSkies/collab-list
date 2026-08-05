import { expect, test, type Page } from '@playwright/test'

const admin = { email: 'admin@example.com', password: 'password123' }

async function login(page: Page) {
  await page.goto('/')
  await page.getByLabel(/email|אימייל/i).fill(admin.email)
  await page.getByLabel(/password|סיסמה/i).fill(admin.password)
  await page.getByRole('button', { name: /sign in|כניסה/i }).click()
  await expect(
    page.getByRole('textbox', { name: /find or add a product|חיפוש או הוספת מוצר/i })
  ).toBeVisible()
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

test('drawers animate into view', async ({ page }) => {
  await login(page)

  await page.getByRole('button', { name: /filter categories|סינון קטגוריות/i }).click()
  const filterDrawer = page.locator('.drawer-popup')
  expect(
    await filterDrawer.evaluate((drawer) => new DOMMatrix(getComputedStyle(drawer).transform).m42)
  ).toBeGreaterThan(0)
  await expect
    .poll(() =>
      filterDrawer.evaluate((drawer) =>
        Math.round(new DOMMatrix(getComputedStyle(drawer).transform).m42)
      )
    )
    .toBe(0)
  await page.getByRole('button', { name: /^close$|^סגירה$/i }).click()
  await expect(filterDrawer).toHaveCount(0)

  await page
    .getByRole('button', { name: /^edit |^עריכת /i })
    .first()
    .click()
  const productDrawer = page.locator('.drawer-popup')
  expect(
    await productDrawer.evaluate((drawer) => new DOMMatrix(getComputedStyle(drawer).transform).m42)
  ).toBeGreaterThan(0)
  await expect
    .poll(() =>
      productDrawer.evaluate((drawer) =>
        Math.round(new DOMMatrix(getComputedStyle(drawer).transform).m42)
      )
    )
    .toBe(0)
})

test('switches direction and persists language from settings', async ({ page }) => {
  await login(page)
  const before = await page.locator('html').getAttribute('dir')
  await page.getByRole('button', { name: /settings|הגדרות/i }).click()
  await page.getByRole('button', { name: /^language$|^שפה$/i }).click()
  await page.getByRole('button', { name: 'עברית' }).click()
  await expect(page.locator('html')).not.toHaveAttribute('dir', before ?? '')
  await page.reload()
  await expect(page.locator('html')).not.toHaveAttribute('dir', before ?? '')
})

test('adds and deletes a category from settings with a destructive warning', async ({ page }) => {
  await login(page)
  const name = `Cheese ${Date.now()}`
  await page.getByRole('button', { name: /settings|הגדרות/i }).click()
  await page.getByRole('button', { name: /^categories$|^קטגוריות$/i }).click()
  await page
    .getByRole('textbox', { name: /find or add a category|חפשו או הוסיפו קטגוריה/i })
    .fill(name)
  await page.getByRole('button', { name: /^add category$|^הוספת קטגוריה$/i }).click()
  await expect(page.getByText(name, { exact: true })).toBeVisible()

  await page.getByRole('button', { name: `Delete ${name}` }).click()
  await expect(page.getByRole('heading', { name: `Delete ${name}?` })).toBeVisible()
  await page.getByRole('button', { name: /^delete category$|^מחיקת קטגוריה$/i }).click()
  await expect(page.getByText(name, { exact: true })).toHaveCount(0)
})
