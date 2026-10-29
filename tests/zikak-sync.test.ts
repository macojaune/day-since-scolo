import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { createClient } from '@libsql/client'
import { createGameService } from '../src/server/game/service'
import { migrateLocalDatabase } from '../src/server/db/local-migrations'
import { pointSyncConfiguration } from '../src/config.js'
import { createPointPublisher, dispatchPointBatch, pointSyncSummary, PointSyncError, retryPointSync, type PointBatch, type PointReceipt } from '../src/server/zikak/outbox'

const START = Date.parse('2030-01-01T12:00:00Z')
const DAY = 86_400_000
async function fixture(t: TestContext, enabled = true) {
  const directory = await mkdtemp(join(tmpdir(), 'scolo-zikak-'))
  const client = createClient({ url: `file:${join(directory, 'test.db')}` })
  t.after(async () => { client.close(); await rm(directory, { recursive: true, force: true }) })
  let current = START
  const service = await createGameService(client, { now: () => new Date(current), zikakApplicationId: enabled ? 'scolo-dev' : undefined })
  const roundId = (await service.getPublicGame()).round.id
  const settle = async () => {
    current += 3_600_000
    return service.settleRound({ roundId, observedAt: new Date(current - 1000), tool: 'sandale' })
  }
  return { client, service, roundId, settle, time: (instant: number) => { current = instant } }
}
function receipt(payload: string): PointReceipt {
  const batch = JSON.parse(payload) as PointBatch
  return { batch_id: batch.batch_id, application_id: 'scolo-dev', applied: true, entries_count: batch.entries.length, applied_at: '2030-01-01T13:00:00Z' }
}

test('only settlement freezes welcome, stakes, payouts and replay bonuses, once', async t => {
  const { client, service, roundId, settle } = await fixture(t)
  await service.ensurePlayer({ userId: 'alice', displayName: 'Alice' })
  await service.placePrediction({ userId: 'alice', roundId, predictedAt: new Date(START), stake: 3, idempotencyKey: 'alice-bet' })
  await service.placePrediction({ userId: 'bob', roundId, predictedAt: new Date(START + DAY), stake: 3, idempotencyKey: 'bob-bet' })
  await service.addHistoricalAppearance({ observedAt: new Date(START - DAY), tool: 'sandale', idempotencyKey: 'old-appearance', actorUserId: 'admin' })
  assert.deepEqual(await pointSyncSummary(client), { sent: 0, pending: 0, blocked: 0 })
  const result = await settle()
  const payload = (await client.execute('SELECT payload FROM scolo_zikak_batches')).rows[0]!.payload
  const batch = JSON.parse(String(payload)) as PointBatch
  assert.deepEqual(batch.entries.map(entry => [entry.reason, entry.amount]), [
    ['welcome', 3], ['reserve', -3], ['welcome', 3], ['reserve', -3], ['payout', 6], ['round_bonus', 2],
  ])
  assert.ok(!String(payload).includes('clerk_user_id'))
  assert.ok(!String(payload).includes('old-appearance'))
  await service.settleRound({ roundId, observedAt: new Date(result.observedAt), tool: 'sandale' })
  assert.deepEqual(await pointSyncSummary(client), { sent: 0, pending: 1, blocked: 0 })
  assert.equal((await client.execute('SELECT payload FROM scolo_zikak_batches')).rows[0]!.payload, payload)
  assert.equal((await service.getPlayerGame('alice')).balance, 6)
  assert.equal((await service.getPlayerGame('bob')).balance, 2)
  await assert.rejects(createGameService(client, { zikakApplicationId: 'scolo-dev-other' }), /autre application/)
})

test('disabled sync leaves no queue and public mode cannot enable the DEV exporter', async t => {
  const { client, service, settle } = await fixture(t, false)
  await service.ensurePlayer({ userId: 'alice' })
  await settle()
  assert.deepEqual(await pointSyncSummary(client), { sent: 0, pending: 0, blocked: 0 })
  await assert.rejects(createGameService(client, { walletMode: 'scolo', zikakApplicationId: 'scolo-dev' }))
})

test('outbox failure rolls back settlement, wallets and encounter together', async t => {
  const { client, service, roundId, settle } = await fixture(t)
  await service.placePrediction({ userId: 'alice', roundId, predictedAt: new Date(START), stake: 3, idempotencyKey: 'alice-bet' })
  await client.execute("CREATE TRIGGER reject_batch BEFORE INSERT ON scolo_zikak_batches BEGIN SELECT RAISE(ABORT, 'test failure'); END")
  await assert.rejects(settle())
  assert.equal((await service.getPublicGame()).round.id, roundId)
  assert.equal((await service.getPlayerGame('alice')).balance, 0)
  assert.equal((await client.execute('SELECT COUNT(*) AS n FROM scolo_settlements')).rows[0]!.n, 0)
  assert.equal((await client.execute('SELECT COUNT(*) AS n FROM "scolo-data"')).rows[0]!.n, 0)
  assert.equal((await client.execute('SELECT COUNT(*) AS n FROM scolo_zikak_batch_entries')).rows[0]!.n, 0)
})

test('large ledger is chunked in insertion order; later rounds export only new movements', async t => {
  const { client, service, settle, time } = await fixture(t)
  for (let i = 0; i < 501; i++) await service.ensurePlayer({ userId: `player-${i}` })
  const original = (await client.execute('SELECT id FROM scolo_wallet_entries ORDER BY rowid')).rows.map(row => String(row.id))
  const result = await settle()
  const batches = (await client.execute('SELECT payload FROM scolo_zikak_batches ORDER BY sequence')).rows.map(row => JSON.parse(String(row.payload)) as PointBatch)
  assert.deepEqual(batches.map(batch => batch.entries.length), [500, 1])
  assert.deepEqual(batches.flatMap(batch => batch.entries.map(entry => entry.reference)), original)
  await service.placePrediction({ userId: 'player-0', roundId: result.nextRoundId!, predictedAt: new Date(START + DAY), stake: 1, idempotencyKey: 'second-round' })
  // A newly inserted movement does not alter frozen batches.
  assert.deepEqual((await client.execute('SELECT payload FROM scolo_zikak_batches ORDER BY sequence')).rows.map(row => JSON.parse(String(row.payload))), batches)
  time(START + DAY)
  await service.settleRound({ roundId: result.nextRoundId!, observedAt: new Date(START + DAY - 1000), tool: 'sandale' })
  const latest = JSON.parse(String((await client.execute('SELECT payload FROM scolo_zikak_batches ORDER BY sequence DESC LIMIT 1')).rows[0]!.payload)) as PointBatch
  assert.deepEqual(latest.entries.map(entry => [entry.reason, entry.amount]), [['reserve', -1], ['payout', 1]])
  assert.equal((await client.execute('SELECT COUNT(*) AS n FROM scolo_zikak_batch_entries')).rows[0]!.n, original.length + 2)
})

test('lost response retries identical batch; failed head blocks all following batches', async t => {
  const { client, service, settle } = await fixture(t)
  for (let i = 0; i < 501; i++) await service.ensurePlayer({ userId: `player-${i}` })
  await settle()
  let clock = START + DAY
  const payloads: string[] = []
  const accepted = new Map<string, PointReceipt>()
  let loseResponse = true
  const publish = async (payload: string) => {
    payloads.push(payload)
    const result = receipt(payload)
    accepted.set(result.batch_id, result)
    if (loseResponse) { loseResponse = false; throw new PointSyncError('NETWORK_OR_TIMEOUT', true) }
    return accepted.get(result.batch_id)!
  }
  assert.equal(await dispatchPointBatch(client, { applicationId: 'scolo-dev', now: () => clock, publish }), 'pending')
  assert.equal(await dispatchPointBatch(client, { applicationId: 'scolo-dev', now: () => clock, publish }), 'idle')
  assert.equal(payloads.length, 1)
  clock += 60_000
  assert.equal(await dispatchPointBatch(client, { applicationId: 'scolo-dev', now: () => clock, publish }), 'sent')
  assert.equal(payloads[0], payloads[1])
  assert.equal(await dispatchPointBatch(client, { applicationId: 'scolo-dev', now: () => clock, publish }), 'sent')
  assert.equal(accepted.size, 2)
  assert.deepEqual(await pointSyncSummary(client), { sent: 2, pending: 0, blocked: 0 })
})

test('leases prevent concurrent sends and recover a process crash with the same payload', async t => {
  const { client, service, settle } = await fixture(t)
  await service.ensurePlayer({ userId: 'alice' }); await settle()
  let clock = START + DAY
  let calls = 0
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  let started!: () => void
  const firstStarted = new Promise<void>(resolve => { started = resolve })
  const first = dispatchPointBatch(client, { applicationId: 'scolo-dev', now: () => clock, publish: async payload => { calls++; started(); await waiting; return receipt(payload) } })
  await firstStarted
  assert.equal(await dispatchPointBatch(client, { applicationId: 'scolo-dev', now: () => clock, publish: async payload => { calls++; return receipt(payload) } }), 'idle')
  release(); await first
  assert.equal(calls, 1)
  await client.execute({ sql: "UPDATE scolo_zikak_batches SET status = 'sending', lease_until = ?, claim_id = 'crashed', receipt = NULL", args: [clock + 30_000] })
  clock += 30_001
  assert.equal(await dispatchPointBatch(client, { applicationId: 'scolo-dev', now: () => clock, publish: async payload => { calls++; return receipt(payload) } }), 'sent')
  assert.equal(calls, 2)
})

test('permanent failures are sanitized, block the queue, and can be explicitly retried', async t => {
  const { client, service, settle } = await fixture(t)
  await service.ensurePlayer({ userId: 'alice' }); await settle()
  const publish = async () => { throw new PointSyncError('HTTP_401', false) }
  const now = () => START + DAY
  assert.equal(await dispatchPointBatch(client, { applicationId: 'scolo-dev', publish, now }), 'blocked')
  assert.equal(await dispatchPointBatch(client, { applicationId: 'scolo-dev', publish, now }), 'idle')
  assert.deepEqual(await pointSyncSummary(client), { sent: 0, pending: 0, blocked: 1 })
  await retryPointSync(client, now())
  assert.equal(await dispatchPointBatch(client, { applicationId: 'scolo-dev', publish: async payload => receipt(payload), now }), 'sent')
  assert.equal((await client.execute('SELECT error_code FROM scolo_zikak_batches')).rows[0]!.error_code, null)
})

test('publisher uses exact endpoint and refuses redirects, wrong receipts and permanent errors', async () => {
  const config = { origin: 'http://localhost:8999', applicationId: 'scolo-dev', token: 'test-only-not-a-real-credential-00000' }
  const payload = JSON.stringify({ batch_id: 'batch', entries: [{ reference: 'entry', subject_id: 'alice', amount: 3, reason: 'welcome', occurred_at: '2030-01-01T12:00:00Z' }] })
  const publisher = createPointPublisher(config, async (url, init) => {
    assert.equal(url, 'http://localhost:8999/api/integrations/v1/point-batches')
    assert.equal(init?.redirect, 'error')
    assert.equal(init?.body, payload)
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${config.token}`)
    return Response.json(receipt(payload))
  })
  assert.deepEqual(await publisher(payload), receipt(payload))
  for (const invalid of [{ ...receipt(payload), application_id: 'other' }, { ...receipt(payload), batch_id: 'other' }, { ...receipt(payload), entries_count: 0 }, { ...receipt(payload), applied: false }]) {
    await assert.rejects(createPointPublisher(config, async () => Response.json(invalid))(payload), (error: unknown) => error instanceof PointSyncError && error.code === 'INVALID_RECEIPT')
  }
  for (const status of [400, 401, 403, 409, 429, 500]) {
    await assert.rejects(createPointPublisher(config, async () => new Response('secret-provider-error', { status }))(payload), (error: unknown) => error instanceof PointSyncError && error.code === `HTTP_${status}` && error.retryable === (status >= 500 || status === 429))
  }
})

test('sync config fails closed for public mode, wrong environments and credential URLs', () => {
  const config = { SCOLO_WALLET_MODE: 'local' as const, SCOLO_ZIKAK_SYNC_ENABLED: 'true' as const, ZIKAK_API_ORIGIN: 'https://api-zikak-dev.marvinl.com', ZIKAK_APPLICATION_ID: 'scolo-dev', ZIKAK_INTEGRATION_TOKEN: 'test-only-not-a-real-credential-00000' }
  assert.equal(pointSyncConfiguration(config)?.applicationId, 'scolo-dev')
  assert.equal(pointSyncConfiguration({ ...config, SCOLO_ZIKAK_SYNC_ENABLED: 'false' }), null)
  assert.throws(() => pointSyncConfiguration({ ...config, SCOLO_WALLET_MODE: 'scolo' }))
  for (const origin of ['https://api-zikak.marvinl.com', 'http://api-zikak-dev.marvinl.com', 'https://evil.example', 'https://api-zikak-dev.marvinl.com/path', 'https://user:secret@api-zikak-dev.marvinl.com', 'https://api-zikak-dev.marvinl.com/?token=x']) {
    assert.throws(() => pointSyncConfiguration({ ...config, ZIKAK_API_ORIGIN: origin }))
  }
  assert.throws(() => pointSyncConfiguration({ ...config, ZIKAK_APPLICATION_ID: 'scolo-prod' }))
  assert.throws(() => pointSyncConfiguration({ ...config, ZIKAK_INTEGRATION_TOKEN: '' }))
})

test('additive migration is repeatable and preserves queued batches and movements', async t => {
  const { client, service, settle } = await fixture(t)
  await service.ensurePlayer({ userId: 'alice' }); await settle()
  const before = await client.execute('SELECT * FROM scolo_zikak_batches')
  const ledger = await client.execute('SELECT * FROM scolo_wallet_entries')
  await migrateLocalDatabase(client); await migrateLocalDatabase(client)
  assert.deepEqual((await client.execute('SELECT * FROM scolo_zikak_batches')).rows, before.rows)
  assert.deepEqual((await client.execute('SELECT * FROM scolo_wallet_entries')).rows, ledger.rows)
})
