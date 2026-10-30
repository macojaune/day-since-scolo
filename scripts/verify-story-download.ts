/** Read-only browser regression against the running LOCAL prototype. No game, account or wallet writes. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium, expect, type Page } from '@playwright/test'

const target = new URL(process.env.SCOLO_TEST_URL ?? 'http://localhost:3104')
assert.equal(target.hostname, 'localhost', 'This check is restricted to the local prototype.')
await mkdir('.local', { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined })
const errors: string[] = []
const results: string[] = []

async function openFixture(page: Page) {
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/trpc/**', async route => {
    const paths = decodeURIComponent(new URL(route.request().url()).pathname).split('/').pop()!.split(',')
    const response = await route.fetch()
    if (!paths.includes('arcade.pending')) return route.fulfill({ response })
    const body: unknown = await response.json()
    const fixture = { result: { data: { json: { id: 'qa-story-readonly', elapsedMs: 10500, crushed: 7, claimed: false, otherAccount: false } } } }
    if (Array.isArray(body)) body[paths.indexOf('arcade.pending')] = fixture
    await route.fulfill({ response, json: Array.isArray(body) ? body : fixture })
  })
  await page.goto(new URL('/#run', target).href, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Le classement', exact: true }).waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: 'Partager le classement', exact: true }).click()
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  // Model a browser that advertises file sharing but leaves its native promise pending.
  await page.addInitScript(`
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: () => {
      window.__nativeShares = (window.__nativeShares || 0) + 1;
      return new Promise(() => {});
    } });
  `)
  await openFixture(page)
  const automatic = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Story 9:16', exact: true }).click()
  const downloaded = await automatic
  await downloaded.saveAs('.local/story-download-regression.png')
  const bytes = await readFile('.local/story-download-regression.png')
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(bytes.readUInt32BE(16), 1080)
  assert.equal(bytes.readUInt32BE(20), 1920)
  await expect(page.getByRole('button', { name: 'Création…', exact: true })).not.toBeVisible({ timeout: 3000 })
  const link = page.getByRole('link', { name: 'Télécharger l’image', exact: true })
  await expect(link).toBeVisible()
  assert.equal(await page.evaluate('window.__nativeShares || 0'), 0)
  await page.getByRole('button', { name: 'Partager l’image', exact: true }).click()
  assert.equal(await page.evaluate('window.__nativeShares || 0'), 1)
  await expect(page.getByRole('button', { name: 'Story 9:16', exact: true })).toBeEnabled()
  const manual = page.waitForEvent('download')
  await link.click()
  const retried = await manual
  assert.equal(retried.suggestedFilename(), 'bet-a-milpat-classement-story.png')
  results.push('PASS: real 1080x1920 PNG download; native sharing never starts during creation; explicit download works even with a pending native share.')
  await page.evaluate('scrollTo(0, 0)')
  await page.screenshot({ path: '.local/story-delivery-desktop.png', fullPage: true, animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate('document.documentElement.scrollWidth > innerWidth'), false)
  await page.screenshot({ path: '.local/story-delivery-mobile.png', fullPage: true, animations: 'disabled' })
  await context.close()

  const fallback = await browser.newPage()
  await fallback.addInitScript(`Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined }); Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });`)
  await openFixture(fallback)
  const fallbackDownload = fallback.waitForEvent('download')
  await fallback.getByRole('button', { name: 'Story 9:16', exact: true }).click()
  await fallbackDownload
  await expect(fallback.getByRole('link', { name: 'Télécharger l’image', exact: true })).toBeVisible()
  await expect(fallback.getByRole('button', { name: 'Partager l’image', exact: true })).toHaveCount(0)
  results.push('PASS: browser without Web Share downloads directly and keeps a manual link.')
  await fallback.close()

  const failure = await browser.newPage()
  await openFixture(failure)
  await failure.route('**/api/sandale-story', route => route.fulfill({ status: 503, json: { error: 'QA simulated failure' } }))
  await failure.getByRole('button', { name: 'Story 9:16', exact: true }).click()
  await expect(failure.getByRole('status').filter({ hasText: 'L’image n’a pas pu être créée.' })).toBeVisible()
  await expect(failure.getByRole('button', { name: 'Story 9:16', exact: true })).toBeEnabled()
  await expect(failure.getByRole('link', { name: 'Télécharger l’image', exact: true })).toHaveCount(0)
  await failure.unroute('**/api/sandale-story')
  let release: (() => void) | undefined
  await failure.route('**/api/sandale-story', async route => {
    await new Promise<void>(resolve => { release = resolve })
    await route.abort().catch(() => undefined)
  })
  await failure.clock.install()
  await failure.getByRole('button', { name: 'Story 9:16', exact: true }).click()
  await expect.poll(() => Boolean(release)).toBe(true)
  await failure.clock.fastForward(21000)
  await expect(failure.getByRole('status').filter({ hasText: 'La création prend trop de temps.' })).toBeVisible()
  await expect(failure.getByRole('button', { name: 'Story 9:16', exact: true })).toBeEnabled()
  release?.()
  results.push('PASS: server error and stalled image request leave a retry action; creation times out after 20 seconds.')
  await failure.close()
  assert.deepEqual(errors, [])
  await writeFile('.local/story-delivery-results.json', JSON.stringify({ results, errors }, null, 2))
  console.log(results.join('\n'))
} finally { await browser.close() }
