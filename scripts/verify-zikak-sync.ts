import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createClient } from '@libsql/client'
import { migrateGameDatabase } from '../src/server/db/local-migrations'
import { createGameService } from '../src/server/game/service'
import { createPointPublisher, type PointReceipt } from '../src/server/zikak/outbox'
import { dispatchPointJob, pointJobsSummary, type PointJobDependencies } from '../src/server/zikak/jobs'
import { claimsFromClerk, createSubjectResolver, type SubjectResolution } from '../src/server/zikak/identity'

// Explicit consumer E2E against the real Go launcher's disposable database only.
const origin = 'http://127.0.0.1:18088'
const environment = process.env.E2E_SCOLO_ENVIRONMENT ?? 'dev'
assert.ok(environment === 'dev' || environment === 'prod', 'E2E_SCOLO_ENVIRONMENT must be dev or prod')
const config = { origin, applicationId: environment === 'prod' ? 'scolo-prod' : 'scolo-dev-e2e-scolo', token: 'synthetic-local-scolo-e2e-only-000000000000' }
const business = 'synthetic-local-business-e2e-only-000000000000'
const directory = await mkdtemp(join(tmpdir(), 'scolo-zikak-http-'))
const client = createClient({ url: `file:${join(directory, 'scolo.db')}` })
const run = randomUUID()
let clock = Date.now() - 120_000
const start = clock
async function admin(path: string, body?: unknown) {
  const response = await fetch(origin + '/api' + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${business}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  assert.equal(response.status, 200, `${path}: ${await response.clone().text()}`)
  return response.json() as Promise<Record<string, unknown>>
}
try {
  assert.equal((await fetch(origin + '/api/health')).status, 200)
  const email = `alice-${run}+clerk_test@example.com`,
    handle = `bob-${run}`
  const alice = await admin('/members', {
    display_name: `Contact Alice ${run}`,
    email,
    notes: 'Synthetic local integration fixture',
  })
  const bob = await admin('/members', {
    display_name: `Contact Bob ${run}`,
    notes: 'Synthetic local integration fixture',
  })
  // Existing audience funds must survive the game synchronization.
  await admin(`/members/${alice.id}/points`, {
    amount: 40,
    entry_type: 'earned',
    source_type: 'fixture',
    notes: 'Synthetic local baseline',
  })
  await admin(`/members/${bob.id}/points`, {
    amount: 7,
    entry_type: 'earned',
    source_type: 'fixture',
    notes: 'Synthetic local baseline',
  })
  await admin(`/members/${alice.id}/identities`, { source_type: 'email', external_id: email })
  await admin(`/members/${bob.id}/identities`, { source_type: 'apify_instagram', external_id: handle })
  await migrateGameDatabase(client)
  const service = await createGameService(client, {
    now: () => new Date(clock),
    environment,
    walletMode: environment === 'prod' ? 'scolo' : 'local',
    zikakApplicationId: config.applicationId,
  })
  const roundId = (await service.getPublicGame()).round.id
  await service.placePrediction({
    userId: 'synthetic-alice',
    displayName: 'Alice',
    roundId,
    predictedAt: new Date(start),
    stake: 3,
    idempotencyKey: 'alice',
  })
  await service.placePrediction({
    userId: 'synthetic-bob',
    displayName: 'Bob',
    roundId,
    predictedAt: new Date(start + 86_400_000),
    stake: 3,
    idempotencyKey: 'bob',
  })
  assert.deepEqual(await pointJobsSummary(client), { sent: 0, pending: 0, blocked: 0, awaitingIdentity: 0 })
  clock += 60_000
  const input = { roundId, observedAt: new Date(clock - 1000), tool: 'sandale' }
  await service.settleRound(input)
  const resolver = createSubjectResolver(config),
    publish = createPointPublisher(config)
  const resolutions = new Map<string, SubjectResolution>()
  const payloads: string[] = []
  let lost = false,
    firstReceipt: PointReceipt | undefined
  const deps: PointJobDependencies = {
    applicationId: config.applicationId,
    now: () => clock,
    claims: async (subject, user) =>
      claimsFromClerk(subject, {
        id: user,
        username: user === 'synthetic-alice' ? `alice-${run}` : handle,
        emailAddresses:
          user === 'synthetic-alice' ? [{ emailAddress: email, verification: { status: 'verified' } }] : [],
      }),
    resolve: async (claims) => {
      const value = await resolver.resolve(claims)
      if (value) resolutions.set(claims.subject_id, value)
      return value
    },
    resolution: resolver.get,
    publish: async (body) => {
      payloads.push(body)
      const value = await publish(body)
      if (!lost) {
        lost = true
        firstReceipt = value
        throw new Error('Synthetic lost response after remote commit')
      }
      return value
    },
  }
  assert.equal(await dispatchPointJob(client, deps), 'pending')
  assert.equal(await dispatchPointJob(client, deps), 'identity_pending')
  const pending = [...resolutions.values()].find((r) => r.status === 'pending')!
  assert.ok(pending)
  assert.equal(
    (await client.execute('SELECT COUNT(*) AS n FROM scolo_zikak_batches')).rows[0]!.n,
    1,
    'pending Bob has no frozen API batch'
  )
  const detail = await admin(`/identity-resolutions/${pending.resolution_id}`)
  assert.equal((detail.candidates as unknown[]).length, 1)
  const rejected = await fetch(origin + '/api/integrations/v1/point-batches', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      batch_id: randomUUID(),
      entries: [
        {
          reference: randomUUID(),
          subject_id: pending.subject_id,
          amount: 1,
          reason: 'fixture',
          occurred_at: new Date().toISOString(),
        },
      ],
    }),
  })
  assert.equal(rejected.status, 409)
  assert.equal(((await rejected.json()) as { error: string }).error, 'identity_unresolved')
  await admin(`/identity-resolutions/${pending.resolution_id}/decide`, {
    revision: pending.revision,
    action: 'link',
    member_id: bob.id,
    note: 'Synthetic E2E: recognised Instagram contact',
  })
  clock += 61_000
  assert.equal(await dispatchPointJob(client, deps), 'sent')
  assert.equal(payloads[0], payloads[1], 'lost response replays the original frozen batch')
  assert.equal(await dispatchPointJob(client, deps), 'sent')
  assert.deepEqual(await pointJobsSummary(client), { sent: 2, pending: 0, blocked: 0, awaitingIdentity: 0 })
  const saved = (await client.execute('SELECT receipt FROM scolo_zikak_batches ORDER BY sequence')).rows
  assert.deepEqual(JSON.parse(String(saved[0]!.receipt)), firstReceipt)
  const aliceAfter = await admin(`/members/${alice.id}`),
    bobAfter = await admin(`/members/${bob.id}`)
  assert.equal(aliceAfter.balance, 46)
  assert.equal(bobAfter.balance, 9)
  assert.deepEqual(await publish(payloads[0]!), firstReceipt)
  assert.equal((await admin(`/members/${alice.id}`)).balance, 46)
  const listing = (await (
    await fetch(origin + '/api/members', { headers: { Authorization: `Bearer ${business}` } })
  ).json()) as { member: { id: string; display_name: string } }[]
  assert.equal(
    listing.filter((item) => item.member.display_name.includes(run)).length,
    2,
    'no duplicate audience member created'
  )
  await service.settleRound(input)
  assert.deepEqual(await pointJobsSummary(client), { sent: 2, pending: 0, blocked: 0, awaitingIdentity: 0 })
  console.log(
    JSON.stringify(
      {
        success: true,
        target: origin,
        existingAudienceBalancesBefore: [40, 7],
        balancesAfter: [46, 9],
        duplicateMembers: 0,
        checks: [
          'existing verified-email contact reused',
          'same member email and email-identity deduplicated',
          'username-only match pending',
          'no frozen batch or credit before admin decision',
          'explicit admin linking',
          'resume after decision',
          'lost response replay identical',
          'original audience funds preserved',
          'settlement replay enqueues once',
        ],
        disposableDatabases: true,
      },
      null,
      2
    )
  )
} finally {
  client.close()
  await rm(directory, { recursive: true, force: true })
}
