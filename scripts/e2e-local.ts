import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { chromium, expect, type Browser, type Page } from '@playwright/test'
import { clerk, clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright'
import { createClient } from '@libsql/client'
import superjson from 'superjson'
import { localInput } from '../src/utils/game-format'
import type { PublicGame, PlayerGame } from '../src/server/game/types'

const application = 'app_2hXOzUjmWpGGjtAWn1SEBISfJqj'
const instance = 'ins_2hXOzUH2op4wuBtsoaa6mNDQhaT'
const baseUrl = 'http://localhost:3092'
const mode = process.env.SCOLO_E2E_MODE ?? 'anonymous'
const runId = randomUUID()
const email = `scolo-e2e-${runId}+clerk_test@example.com`
const output = path.resolve('.local/e2e', runId)
const report: {
  runId: string; startedAt: string; application: string; instance: string; target: string
  fixtureId?: string; completedAt?: string; success: boolean; checks: string[]
  cleanup: string[]; errors: string[]; browser?: string
  mode: string; authenticatedFlowVerified: boolean
} = {
  runId, startedAt: new Date().toISOString(), application, instance, target: baseUrl,
  mode, authenticatedFlowVerified: false, success: false, checks: [], cleanup: [], errors: [],
}
let fixtureId: string | undefined
let browser: Browser | undefined

function checked(message: string) {
  report.checks.push(message)
  console.log(`PASS ${message}`)
}

function safeMessage(error: unknown): string {
  return String(error instanceof Error ? error.message : error)
    .replace(/(?:sk|pk)_(?:test|live)_[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED JWT]')
}

function clerkCli(args: string[]): string {
  try {
    return execFileSync('clerk', ['api', ...args, '--app', application, '--instance', instance], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
    })
  } catch (error) {
    const details = error as { stderr?: string; stdout?: string }
    throw new Error(safeMessage(details.stderr || details.stdout || error))
  }
}

type ClerkFixture = {
  id: string
  external_id: string
  email_addresses: { email_address: string }[]
  private_metadata: { scolo_local_e2e?: boolean; run_id?: string }
}

function assertFixture(user: ClerkFixture) {
  assert.equal(user.external_id, `scolo-local-e2e-${runId}`)
  assert.equal(user.private_metadata.scolo_local_e2e, true)
  assert.equal(user.private_metadata.run_id, runId)
  assert.ok(user.email_addresses.length === 0 || (
    user.email_addresses.length === 1 && user.email_addresses[0]?.email_address === email
  ))
  assert.match(user.id, /^user_/)
}

type Wire = {
  result?: { data: Parameters<typeof superjson.deserialize>[0] }
  error?: { json?: { data?: { code?: string }; message?: string } }
}

async function rpc(page: Page, name: string, input?: unknown, method: 'GET' | 'POST' = 'GET') {
  const payload = superjson.serialize(input)
  const response = await page.evaluate(async ({ endpoint, serialized, verb }) => {
    const url = verb === 'GET' ? `${endpoint}?input=${encodeURIComponent(JSON.stringify(serialized))}` : endpoint
    const result = await fetch(url, {
      method: verb,
      headers: verb === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: verb === 'POST' ? JSON.stringify(serialized) : undefined,
    })
    return { status: result.status, body: await result.json() as unknown }
  }, { endpoint: `/api/trpc/${name}`, serialized: payload, verb: method })
  return { status: response.status, wire: response.body as Wire }
}

function rpcData<T>(response: Awaited<ReturnType<typeof rpc>>): T {
  assert.equal(response.status, 200, JSON.stringify(response.wire.error))
  assert.ok(response.wire.result)
  return superjson.deserialize<T>(response.wire.result.data)
}

function expectDenied(response: Awaited<ReturnType<typeof rpc>>, code: 'UNAUTHORIZED' | 'FORBIDDEN') {
  assert.equal(response.status, code === 'UNAUTHORIZED' ? 401 : 403)
  assert.equal(response.wire.error?.json?.data?.code, code)
}

async function cleanupLocalFixture(userId: string) {
  const client = createClient({ url: process.env.DATABASE_URL! })
  try {
    const transaction = await client.transaction('write')
    try {
      const player = await transaction.execute({
        sql: 'SELECT * FROM scolo_players WHERE clerk_user_id = ?',
        args: [userId],
      })
      if (!player.rows.length) {
        await transaction.commit()
        report.cleanup.push('Aucun enregistrement local pour la fixture.')
        return
      }
      assert.equal(player.rows.length, 1)
      const playerId = String(player.rows[0]!.id)
      const predictions = await transaction.execute({
        sql: 'SELECT * FROM scolo_predictions WHERE player_id = ?', args: [playerId],
      })
      assert.ok(predictions.rows.every(row => row.status === 'active'), 'Refus de nettoyer une fixture dont la manche a été réglée.')
      const wallet = await transaction.execute({ sql: 'SELECT * FROM scolo_wallets WHERE player_id = ?', args: [playerId] })
      const entries = await transaction.execute({ sql: 'SELECT * FROM scolo_wallet_entries WHERE player_id = ?', args: [playerId] })
      assert.ok(entries.rows.every(row => row.kind === 'welcome' || row.kind === 'reserve'))
      await writeFile(path.join(output, 'fixture-local-before-delete.json'), JSON.stringify({
        player: player.rows, wallet: wallet.rows, predictions: predictions.rows, entries: entries.rows,
      }, null, 2))
      await transaction.execute({ sql: 'DELETE FROM scolo_predictions WHERE player_id = ?', args: [playerId] })
      await transaction.execute({ sql: 'DELETE FROM scolo_wallet_entries WHERE player_id = ?', args: [playerId] })
      await transaction.execute({ sql: 'DELETE FROM scolo_wallets WHERE player_id = ?', args: [playerId] })
      await transaction.execute({ sql: 'DELETE FROM scolo_players WHERE id = ? AND clerk_user_id = ?', args: [playerId, userId] })
      await transaction.commit()
      const remaining = await client.execute({
        sql: 'SELECT count(*) AS count FROM scolo_players WHERE clerk_user_id = ?', args: [userId],
      })
      assert.equal(Number(remaining.rows[0]?.count), 0)
      report.cleanup.push(`Fixture locale supprimée : 1 joueur, 1 portefeuille, ${predictions.rows.length} pronostic(s), ${entries.rows.length} écritures. Sauvegarde ciblée conservée.`)
    } catch (error) {
      await transaction.rollback()
      throw error
    }
  } finally { client.close() }
}

await mkdir(output, { recursive: true })
try {
  assert.equal(process.env.APP_URL, baseUrl)
  assert.ok(mode === 'anonymous' || mode === 'ui')
  assert.equal(process.env.SCOLO_WALLET_MODE, 'local')
  assert.ok(process.env.DATABASE_URL?.startsWith('file:'))
  assert.ok(process.env.CLERK_SECRET_KEY?.startsWith('sk_test_'))
  assert.ok(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith('pk_test_'))
  const identity = JSON.parse(execFileSync('clerk', ['whoami'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
  })) as { email: string; linked: { appId: string; instances: { development: string } } }
  assert.equal(identity.email, 'contact@marvinl.com')
  assert.equal(identity.linked.appId, application)
  assert.equal(identity.linked.instances.development, instance)
  checked('Compte personnel, application Scolo et instance Clerk DEV vérifiés.')

  const executablePath = chromium.executablePath()
  assert.ok(existsSync(executablePath), 'Chrome for Testing doit déjà être installé ; ce script ne télécharge rien.')
  report.browser = executablePath
  await clerkSetup({ publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, dotenv: false })
  browser = await chromium.launch({ headless: true, executablePath })
  const context = await browser.newContext({ locale: 'fr-FR', timezoneId: 'America/Guadeloupe', viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.setDefaultTimeout(30000)
  page.setDefaultNavigationTimeout(60000)
  await setupClerkTestingToken({ page })
  await page.goto(baseUrl)
  await clerk.loaded({ page })
  await expect(page.getByRole('heading', { name: 'Jou san bèt a mil pat', exact: true })).toBeVisible()
  const baseline = rpcData<PublicGame>(await rpc(page, 'app.game'))
  checked('Jeu public servi sur localhost:3092 dans un navigateur séparé.')


  await page.goto(`${baseUrl}/sign-in`)
  await expect(page.locator('.cl-signIn-root')).toBeVisible()
  const signInButtons = await page.locator('.cl-socialButtons button').allTextContents()
  assert.ok(signInButtons.length > 0)
  checked(`Interface Clerk rendue ; méthodes visibles : ${signInButtons.join(', ')}.`)
  await page.screenshot({ path: path.join(output, 'clerk-connexion.png'), fullPage: true })
  await page.goto(baseUrl)
  const anonymousViewer = 'user_scolo_e2e_anonymous'
  expectDenied(await rpc(page, 'app.me', { viewerId: anonymousViewer }), 'UNAUTHORIZED')
  expectDenied(await rpc(page, 'app.join', { viewerId: anonymousViewer }, 'POST'), 'UNAUTHORIZED')
  expectDenied(await rpc(page, 'app.bet', {
    viewerId: anonymousViewer, roundId: baseline.round.id,
    predictedAt: new Date(Date.now() + 86400000), stake: 1, idempotencyKey: runId,
  }, 'POST'), 'UNAUTHORIZED')
  expectDenied(await rpc(page, 'app.previewSettlement', {
    roundId: baseline.round.id, observedAt: new Date(), tool: 'sandale',
  }, 'POST'), 'UNAUTHORIZED')
  checked('Sans session : lectures privées, inscription au jeu, mise et aperçu administrateur refusés (401).')
  const wrongOrigin = await page.request.post(`${baseUrl}/api/trpc/app.join`, {
    headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' },
    data: JSON.stringify(superjson.serialize({ viewerId: anonymousViewer })),
  })
  expectDenied({ status: wrongOrigin.status(), wire: await wrongOrigin.json() as Wire }, 'FORBIDDEN')
  checked('Mutation depuis une autre origine refusée (403).')
  await page.goto(`${baseUrl}/admin`)
  await expect(page.getByRole('heading', { name: 'Connecte-toi pour continuer.' })).toBeVisible()
  await expect(page.getByLabel('Date et heure réelles de l’apparition')).toHaveCount(0)
  await page.screenshot({ path: path.join(output, 'admin-deconnecte.png'), fullPage: true })
  checked('Page administrateur anonyme : connexion exigée et formulaire absent.')
  const unchanged = rpcData<PublicGame>(await rpc(page, 'app.game'))
  assert.equal(unchanged.round.id, baseline.round.id)
  assert.equal(unchanged.round.pot, baseline.round.pot)
  assert.equal(unchanged.round.predictionCount, baseline.round.predictionCount)
  assert.deepEqual(unchanged.history, baseline.history)
  checked('Manche, cagnotte, pronostics et historique inchangés après les contrôles anonymes.')

  if (mode === 'ui') {
    const configuration = JSON.parse(execFileSync('clerk', [
      'config', 'pull', '--app', application, '--instance', instance, '--keys', 'auth_email',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 })) as {
      auth_email?: { used_for_sign_in?: boolean; used_for_sign_up?: boolean }
    }
    assert.ok(configuration.auth_email?.used_for_sign_in || configuration.auth_email?.used_for_sign_up,
      'E2E connecté bloqué : l’instance Scolo n’accepte pas de fixture email. Utilise un vrai login X/Twitter ; ce script ne modifie jamais les méthodes Clerk.')
  const body = {
    first_name: 'Scolo',
    last_name: 'E2E',
    external_id: `scolo-local-e2e-${runId}`,
    private_metadata: { scolo_local_e2e: true, run_id: runId },
    skip_password_requirement: true,
  }
  clerkCli(['/users', '-X', 'POST', '-d', JSON.stringify(body), '--dry-run'])
  checked('Création de fixture Clerk prévisualisée par CLI.')
  const fixture = JSON.parse(clerkCli(['/users', '-X', 'POST', '-d', JSON.stringify(body), '--yes'])) as ClerkFixture
  fixtureId = fixture.id
  report.fixtureId = fixtureId
  assertFixture(fixture)
  checked('Fixture sans email créée exclusivement dans Scolo DEV (identifiants email/username désactivés dans cette instance).')

  if (mode === 'ui') {
    const addressPayload = JSON.stringify({ user_id: fixtureId, email_address: email, verified: true, primary: true })
    clerkCli(['/email_addresses', '-X', 'POST', '-d', addressPayload, '--dry-run'])
    const address = JSON.parse(clerkCli(['/email_addresses', '-X', 'POST', '-d', addressPayload, '--yes'])) as { email_address: string }
    assert.equal(address.email_address, email)
    checked('Adresse +clerk_test attachée à la seule fixture par API ; aucune méthode de connexion globale modifiée.')
  }

  const ticketPayload = JSON.stringify({ user_id: fixtureId, expires_in_seconds: 60 })
  clerkCli(['/sign_in_tokens', '-X', 'POST', '-d', ticketPayload, '--dry-run'])
  const signInToken = JSON.parse(clerkCli(['/sign_in_tokens', '-X', 'POST', '-d', ticketPayload, '--yes'])) as { token: string }
  await clerk.signIn({ page, signInParams: { strategy: 'ticket', ticket: signInToken.token } })
  await page.goto(baseUrl)
  await expect(page.locator('.wallet-pill')).toHaveText(/3\s+Zikak disponibles/)
  assert.equal(await page.evaluate(() => window.Clerk.user?.id), fixtureId)
  const initialPlayer = rpcData<PlayerGame & { registered: boolean; isAdmin: boolean }>(
    await rpc(page, 'app.me', { viewerId: fixtureId }),
  )
  assert.equal(initialPlayer.balance, 3)
  assert.equal(initialPlayer.isAdmin, false)
  assert.equal(initialPlayer.registered, true)
  checked('Session Clerk réelle reconnue côté serveur ; bonus initial de 3 Zikak, membre non administrateur.')

  await page.reload()
  await expect(page.locator('.wallet-pill')).toHaveText(/3\s+Zikak disponibles/)
  const joinedAgain = await rpc(page, 'app.join', { viewerId: fixtureId }, 'POST')
  assert.equal(joinedAgain.status, 200)
  const client = createClient({ url: process.env.DATABASE_URL! })
  try {
    const welcome = await client.execute({
      sql: `SELECT count(*) AS count, sum(e.amount) AS total FROM scolo_wallet_entries e
        JOIN scolo_players p ON p.id = e.player_id WHERE p.clerk_user_id = ? AND e.kind = 'welcome'`,
      args: [fixtureId],
    })
    assert.equal(Number(welcome.rows[0]?.count), 1)
    assert.equal(Number(welcome.rows[0]?.total), 3)
  } finally { client.close() }
  checked('Bonus unique après rechargement et répétition explicite de join : une écriture de +3.')

  const prediction = localInput(new Date(Date.now() + 2 * 86400000))
  await page.getByLabel('Date et heure de ton pronostic').fill(prediction)
  await page.getByLabel('Ta mise en Zikak', { exact: true }).fill('1')
  await page.getByRole('button', { name: 'Vérifier mon pronostic', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Confirmer ma mise', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Confirmer ma mise', exact: true }).click()
  await expect(page.locator('.wallet-pill')).toHaveText(/2\s+Zikak disponibles/)
  await expect(page.locator('.personal-ticket')).toHaveCount(1)
  await expect(page.locator('.personal-ticket')).toContainText('1 Zikak misés')
  await expect(page.locator('.personal-ticket')).toContainText('En jeu')
  const afterBet = rpcData<PlayerGame>(await rpc(page, 'app.me', { viewerId: fixtureId }))
  assert.equal(afterBet.balance, 2)
  assert.equal(afterBet.committed, 1)
  assert.equal(afterBet.predictions.length, 1)
  assert.equal(afterBet.predictions[0]?.stake, 1)
  await page.screenshot({ path: path.join(output, 'ticket-confirme.png'), fullPage: true })
  checked('Mise de 1 via le formulaire et confirmation UI : solde 2, engagement 1, un ticket actif.')

  await page.goto(`${baseUrl}/admin`)
  await expect(page.getByRole('heading', { name: 'Cette page est réservée à Marvin.' })).toBeVisible()
  expectDenied(await rpc(page, 'app.previewSettlement', {
    roundId: baseline.round.id, observedAt: new Date(), tool: 'sandale',
  }, 'POST'), 'FORBIDDEN')
  checked('Membre refusé sur /admin et par previewSettlement côté serveur.')
  expectDenied(await rpc(page, 'app.me', { viewerId: 'user_other_fixture' }), 'UNAUTHORIZED')
  checked('Une identité viewerId différente de la session est refusée.')

  await page.goto(baseUrl)
  await expect(page.locator('.wallet-pill')).toHaveText(/2\s+Zikak disponibles/)
  await page.locator('.cl-userButtonTrigger').click()
  await page.getByText('Se déconnecter', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Se connecter', exact: true })).toBeVisible()
  await expect(page.locator('.wallet-pill')).toHaveCount(0)
  assert.equal(await page.evaluate(() => window.Clerk.user), null)
  expectDenied(await rpc(page, 'app.me', { viewerId: fixtureId }), 'UNAUTHORIZED')
  expectDenied(await rpc(page, 'app.join', { viewerId: fixtureId }, 'POST'), 'UNAUTHORIZED')
  await page.goto(`${baseUrl}/admin`)
  await expect(page.getByRole('heading', { name: 'Connecte-toi pour continuer.' })).toBeVisible()
  await page.screenshot({ path: path.join(output, 'admin-deconnecte.png'), fullPage: true })
  checked('Déconnexion par le menu Clerk : session supprimée, me/join refusés, /admin exige une connexion.')

  const finalGame = rpcData<PublicGame>(await rpc(page, 'app.game'))
  assert.equal(finalGame.round.id, baseline.round.id)
  assert.deepEqual(finalGame.history, baseline.history)
  checked('Aucun règlement de manche ni apparition ajoutée.')
  report.authenticatedFlowVerified = true
  }
  report.success = true
} catch (error) {
  report.errors.push(safeMessage(error))
  console.error(`FAIL ${safeMessage(error)}`)
} finally {
  if (browser) await browser.close().catch(error => report.errors.push(`Fermeture navigateur : ${safeMessage(error)}`))
  if (fixtureId) {
    try { await cleanupLocalFixture(fixtureId) }
    catch (error) { report.errors.push(`Nettoyage local : ${safeMessage(error)}`) }
    try {
      const existing = JSON.parse(clerkCli([`/users/${fixtureId}`])) as ClerkFixture
      assertFixture(existing)
      clerkCli([`/users/${fixtureId}`, '-X', 'DELETE', '--dry-run'])
      const deleted = JSON.parse(clerkCli([`/users/${fixtureId}`, '-X', 'DELETE', '--yes'])) as { id: string; deleted: boolean }
      assert.equal(deleted.id, fixtureId)
      assert.equal(deleted.deleted, true)
      report.cleanup.push('Fixture Clerk supprimée par CLI après relecture du marqueur et dry-run.')
    } catch (error) { report.errors.push(`Nettoyage Clerk : ${safeMessage(error)}`) }
  }
  report.completedAt = new Date().toISOString()
  report.success = report.success && report.errors.length === 0
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ success: report.success, checks: report.checks.length, cleanup: report.cleanup, report: path.join(output, 'report.json') }, null, 2))
  if (!report.success) process.exitCode = 1
}
