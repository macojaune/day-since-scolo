/** Read-only regression for the URL-controlled leaderboard and delayed native dialog close events. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'

const target = new URL(process.env.SCOLO_TEST_URL ?? 'http://localhost:3092')
assert.ok(['localhost', 'dev-scolo.marvinl.com'].includes(target.hostname), 'Use a local or DEV application.')
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined })
try {
  const page = await browser.newPage()
  const mutations: string[] = []
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    if (route.request().method() === 'GET' || route.request().method() === 'HEAD') return route.continue()
    mutations.push(new URL(route.request().url()).pathname)
    await route.abort()
  })
  await page.goto(new URL('/?source=navigation-check&classement=1#rencontres', target).href, { waitUntil: 'domcontentloaded' })
  const dialog = page.getByRole('dialog', { name: 'Le classement' })
  await expect(dialog).toBeVisible({ timeout: 30000 })
  await dialog.getByRole('button', { name: 'Fermer le classement' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page).toHaveURL(new URL('/?source=navigation-check#rencontres', target).href)
  const footer = page.getByRole('link', { name: 'Classement de la sandale' })
  await footer.click()
  await expect(dialog).toBeVisible()
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.goBack()
    await expect(dialog).not.toBeVisible()
    // Forward immediately after the controlled close, while its native event may still be queued.
    await page.goForward()
    await expect(dialog).toBeVisible()
    // Replay the previous native close arriving late, after Forward has reopened the dialog.
    await dialog.evaluate(node => node.dispatchEvent(new Event('close')))
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(page).toHaveURL(new URL('/?classement=1', target).href)
    await expect(dialog).toBeVisible()
    await expect(page.locator('dialog[open]')).toHaveCount(1)
  }
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(page).toHaveURL(new URL('/', target).href)
  await footer.click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Fermer le classement' })).toBeFocused()
  await page.mouse.click(1, 1)
  await expect(dialog).not.toBeVisible()
  await expect(page).toHaveURL(new URL('/', target).href)
  await expect(footer).toBeFocused()
  assert.deepEqual(mutations, [])
  assert.deepEqual(errors, [])
  await mkdir('.local', { recursive: true })
  const result = { target: target.origin, forwardCycles: 3, reload: true, escape: true, backdrop: true, focusRestored: true, mutations, errors }
  await writeFile('.local/leaderboard-navigation.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally { await browser.close() }
