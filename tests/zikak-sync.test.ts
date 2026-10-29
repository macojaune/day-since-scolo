import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { createClient } from '@libsql/client'
import { createGameService } from '../src/server/game/service'
import { migrateLocalDatabase } from '../src/server/db/local-migrations'
import { pointSyncConfiguration } from '../src/config.js'
import {
  createPointPublisher,
  enqueuePointBatches,
  PointSyncError,
  type PointBatch,
  type PointReceipt,
} from '../src/server/zikak/outbox'
import { dispatchPointJob, pointJobsSummary, retryPointJobs, type PointJobDependencies } from '../src/server/zikak/jobs'
import { claimsFromClerk, createSubjectResolver, type SubjectResolution } from '../src/server/zikak/identity'

const START = Date.parse('2030-01-01T12:00:00Z'),
  DAY = 86_400_000
async function fixture(t: TestContext, enabled = true) {
  const directory = await mkdtemp(join(tmpdir(), 'scolo-zikak-'))
  const client = createClient({ url: `file:${join(directory, 'test.db')}` })
  t.after(async () => {
    client.close()
    await rm(directory, { recursive: true, force: true })
  })
  let current = START
  const service = await createGameService(client, {
    now: () => new Date(current),
    environment: 'dev',
    zikakApplicationId: enabled ? 'scolo-dev' : undefined,
  })
  const roundId = (await service.getPublicGame()).round.id
  const settle = async () => {
    current += 3_600_000
    return service.settleRound({ roundId, observedAt: new Date(current - 1000), tool: 'sandale' })
  }
  return {
    client,
    service,
    roundId,
    settle,
    time: (instant: number) => {
      current = instant
    },
  }
}
function receipt(payload: string): PointReceipt {
  const batch = JSON.parse(payload) as PointBatch
  return {
    batch_id: batch.batch_id,
    application_id: 'scolo-dev',
    applied: true,
    entries_count: batch.entries.length,
    applied_at: '2030-01-01T13:00:00Z',
  }
}
function resolution(subject: string, linked = true): SubjectResolution {
  return {
    resolution_id: `resolution-${subject}`,
    application_id: 'scolo-dev',
    subject_id: subject,
    status: linked ? 'linked' : 'pending',
    can_sync_points: linked,
    reason: linked ? 'verified_email_match' : 'username_review',
    revision: 1,
  }
}
function dependencies(overrides: Partial<PointJobDependencies> = {}): PointJobDependencies {
  return {
    applicationId: 'scolo-dev',
    now: () => START + DAY,
    claims: async (subject, user) =>
      claimsFromClerk(subject, {
        id: user,
        username: user,
        emailAddresses: [{ emailAddress: `${user}@example.test`, verification: { status: 'verified' } }],
      }),
    resolve: async (claims) => resolution(claims.subject_id),
    resolution: async (subject) => resolution(subject),
    publish: async (payload) => receipt(payload),
    ...overrides,
  }
}

test('settlement snapshots each subject once; no batch is frozen before identity resolution', async (t) => {
  const { client, service, roundId, settle } = await fixture(t)
  await service.placePrediction({
    userId: 'alice',
    roundId,
    predictedAt: new Date(START),
    stake: 3,
    idempotencyKey: 'alice',
  })
  await service.placePrediction({
    userId: 'bob',
    roundId,
    predictedAt: new Date(START + DAY),
    stake: 3,
    idempotencyKey: 'bob',
  })
  await service.addHistoricalAppearance({
    observedAt: new Date(START - DAY),
    tool: 'sandale',
    idempotencyKey: 'history',
    actorUserId: 'admin',
  })
  assert.deepEqual(await pointJobsSummary(client), { sent: 0, pending: 0, blocked: 0, awaitingIdentity: 0 })
  const result = await settle()
  const jobs = (await client.execute('SELECT * FROM scolo_zikak_jobs ORDER BY sequence')).rows
  assert.equal(jobs.length, 2)
  assert.deepEqual(
    jobs.map((row) => (JSON.parse(String(row.movements)) as PointBatch['entries']).map((e) => [e.reason, e.amount])),
    [
      [
        ['welcome', 3],
        ['reserve', -3],
        ['payout', 6],
      ],
      [
        ['welcome', 3],
        ['reserve', -3],
        ['round_bonus', 2],
      ],
    ]
  )
  assert.equal((await client.execute('SELECT COUNT(*) AS n FROM scolo_zikak_batches')).rows[0]!.n, 0)
  await service.settleRound({ roundId, observedAt: new Date(result.observedAt), tool: 'sandale' })
  assert.equal((await client.execute('SELECT COUNT(*) AS n FROM scolo_zikak_jobs')).rows[0]!.n, 2)
  await assert.rejects(
    createGameService(client, { environment: 'dev', zikakApplicationId: 'scolo-dev-other' }),
    /autre application/
  )
})

test('pending identity keeps movements unfrozen while another player receives points', async (t) => {
  const { client, service, roundId, settle } = await fixture(t)
  const alice = await service.ensurePlayer({ userId: 'alice' })
  await service.placePrediction({
    userId: 'alice',
    roundId,
    predictedAt: new Date(START),
    stake: 3,
    idempotencyKey: 'alice',
  })
  await service.placePrediction({
    userId: 'bob',
    roundId,
    predictedAt: new Date(START + DAY),
    stake: 3,
    idempotencyKey: 'bob',
  })
  await settle()
  let approved = false,
    clock = START + DAY,
    profiles = 0
  const sent: string[] = []
  const deps = dependencies({
    now: () => clock,
    claims: async (subject, user) => {
      profiles++
      return claimsFromClerk(subject, { id: user, username: user, emailAddresses: [] })
    },
    resolve: async (claims) => resolution(claims.subject_id, claims.subject_id !== alice.id || approved),
    resolution: async (subject) => resolution(subject, subject !== alice.id || approved),
    publish: async (payload) => {
      sent.push(payload)
      return receipt(payload)
    },
  })
  assert.equal(await dispatchPointJob(client, deps), 'identity_pending')
  assert.equal((await client.execute('SELECT COUNT(*) AS n FROM scolo_zikak_batches')).rows[0]!.n, 0)
  assert.equal(await dispatchPointJob(client, deps), 'sent')
  assert.equal(sent.length, 1)
  assert.equal(JSON.parse(sent[0]!).entries.at(-1).reason, 'round_bonus')
  assert.deepEqual(await pointJobsSummary(client), { sent: 1, pending: 0, blocked: 0, awaitingIdentity: 1 })
  approved = true
  clock += 61_000
  assert.equal(await dispatchPointJob(client, deps), 'sent')
  assert.equal(profiles, 2, 'an admin decision is reread without inventing or replacing the stored claims')
  assert.deepEqual(await pointJobsSummary(client), { sent: 2, pending: 0, blocked: 0, awaitingIdentity: 0 })
})

test('job insertion failure rolls back appearance, result, payouts and reservation snapshot together', async (t) => {
  const { client, service, roundId, settle } = await fixture(t)
  await service.placePrediction({
    userId: 'alice',
    roundId,
    predictedAt: new Date(START),
    stake: 3,
    idempotencyKey: 'alice',
  })
  await client.execute(
    "CREATE TRIGGER reject_job BEFORE INSERT ON scolo_zikak_jobs BEGIN SELECT RAISE(ABORT,'test failure'); END"
  )
  await assert.rejects(settle())
  assert.equal((await service.getPublicGame()).round.id, roundId)
  assert.equal((await service.getPlayerGame('alice')).balance, 0)
  assert.equal((await client.execute('SELECT COUNT(*) AS n FROM scolo_settlements')).rows[0]!.n, 0)
  assert.equal((await client.execute('SELECT COUNT(*) AS n FROM "scolo-data"')).rows[0]!.n, 0)
  assert.equal((await client.execute('SELECT COUNT(*) AS n FROM scolo_zikak_job_entries')).rows[0]!.n, 0)
})

test('large subject journal is chunked in original order and later rounds enqueue only new entries', async (t) => {
  const { client, service, roundId, settle, time } = await fixture(t)
  const player = await service.ensurePlayer({ userId: 'alice' })
  // Explicit disposable ledger fixtures: exercise the real 500-movement boundary.
  await client.batch(
    Array.from({ length: 500 }, (_, i) => ({
      sql: "INSERT INTO scolo_wallet_entries (id,player_id,amount,kind,reference,created_at) VALUES (?,?,1,'fixture',?,?)",
      args: [`fixture-${i}`, player.id, `fixture-${i}`, START],
    })),
    'write'
  )
  await client.execute({ sql: 'UPDATE scolo_wallets SET balance=503 WHERE player_id=?', args: [player.id] })
  await service.placePrediction({
    userId: 'alice',
    roundId,
    predictedAt: new Date(START),
    stake: 501,
    idempotencyKey: 'large',
  })
  const result = await settle()
  const jobs = (await client.execute('SELECT movements FROM scolo_zikak_jobs ORDER BY sequence')).rows.map(
    (row) => JSON.parse(String(row.movements)) as PointBatch['entries']
  )
  assert.deepEqual(
    jobs.map((j) => j.length),
    [500, 3]
  )
  const refs = (await client.execute('SELECT id FROM scolo_wallet_entries ORDER BY rowid')).rows.map((row) =>
    String(row.id)
  )
  assert.deepEqual(
    jobs.flatMap((j) => j.map((e) => e.reference)),
    refs
  )
  await service.placePrediction({
    userId: 'alice',
    roundId: result.nextRoundId!,
    predictedAt: new Date(START + DAY),
    stake: 1,
    idempotencyKey: 'next',
  })
  time(START + DAY)
  await service.settleRound({ roundId: result.nextRoundId!, observedAt: new Date(START + DAY - 1000), tool: 'sandale' })
  const last = JSON.parse(
    String(
      (await client.execute('SELECT movements FROM scolo_zikak_jobs ORDER BY sequence DESC LIMIT 1')).rows[0]!.movements
    )
  ) as PointBatch['entries']
  assert.deepEqual(
    last.map((e) => [e.reason, e.amount]),
    [
      ['reserve', -1],
      ['payout', 1],
    ]
  )
  const payloads: string[] = []
  const deps = dependencies({
    publish: async (body) => {
      payloads.push(body)
      return receipt(body)
    },
  })
  for (let i = 0; i < 3; i++) assert.equal(await dispatchPointJob(client, deps), 'sent')
  assert.deepEqual(
    payloads.flatMap((body) => (JSON.parse(body) as PointBatch).entries.map((e) => e.reference)),
    [...refs, ...last.map((e) => e.reference)]
  )
})

test('lost response retries exactly the same frozen batch and receipt', async (t) => {
  const { client, service, settle } = await fixture(t)
  await service.ensurePlayer({ userId: 'alice' })
  await settle()
  let clock = START + DAY,
    lose = true
  const payloads: string[] = [],
    receipts = new Map<string, PointReceipt>()
  const deps = dependencies({
    now: () => clock,
    publish: async (body) => {
      payloads.push(body)
      const result = receipt(body)
      receipts.set(result.batch_id, result)
      if (lose) {
        lose = false
        throw new PointSyncError('NETWORK_OR_TIMEOUT', true)
      }
      return receipts.get(result.batch_id)!
    },
  })
  assert.equal(await dispatchPointJob(client, deps), 'pending')
  const frozen = (await client.execute('SELECT payload FROM scolo_zikak_batches')).rows[0]!.payload
  assert.equal(await dispatchPointJob(client, deps), 'idle')
  clock += 61_000
  assert.equal(await dispatchPointJob(client, deps), 'sent')
  assert.equal(payloads[0], payloads[1])
  assert.equal(frozen, payloads[0])
  assert.equal(receipts.size, 1)
  assert.deepEqual(
    JSON.parse(String((await client.execute('SELECT receipt FROM scolo_zikak_batches')).rows[0]!.receipt)),
    receipt(payloads[0]!)
  )
})

test('lease prevents simultaneous sends and an expired lease resumes the same batch', async (t) => {
  const { client, service, settle } = await fixture(t)
  await service.ensurePlayer({ userId: 'alice' })
  await settle()
  let clock = START + DAY,
    calls = 0,
    release!: () => void,
    started!: () => void
  const wait = new Promise<void>((resolve) => {
      release = resolve
    }),
    ready = new Promise<void>((resolve) => {
      started = resolve
    })
  const bodies: string[] = []
  const deps = dependencies({
    now: () => clock,
    publish: async (body) => {
      bodies.push(body)
      calls++
      if (calls === 1) {
        started()
        await wait
      }
      return receipt(body)
    },
  })
  const first = dispatchPointJob(client, deps)
  await ready
  assert.equal(await dispatchPointJob(client, deps), 'idle')
  clock += 90_001
  assert.equal(await dispatchPointJob(client, deps), 'sent')
  release()
  await first
  assert.equal(bodies[0], bodies[1])
  assert.equal((await client.execute('SELECT status FROM scolo_zikak_jobs')).rows[0]!.status, 'sent')
})

test('blocked subject does not gate others and explicit retry preserves its frozen payload', async (t) => {
  const { client, service, settle } = await fixture(t)
  await service.ensurePlayer({ userId: 'alice' })
  await service.ensurePlayer({ userId: 'bob' })
  await settle()
  let reject = true
  const bodies: string[] = []
  const deps = dependencies({
    publish: async (body) => {
      bodies.push(body)
      if (reject) {
        reject = false
        throw new PointSyncError('HTTP_401', false)
      }
      return receipt(body)
    },
  })
  assert.equal(await dispatchPointJob(client, deps), 'blocked')
  assert.equal(await dispatchPointJob(client, deps), 'sent')
  await retryPointJobs(client, START + DAY)
  assert.equal(await dispatchPointJob(client, deps), 'sent')
  assert.equal(bodies[0], bodies[2])
  assert.deepEqual(await pointJobsSummary(client), { sent: 2, pending: 0, blocked: 0, awaitingIdentity: 0 })
})

test('missing profiles and identity conflicts never create an API points batch', async (t) => {
  const { client, service, settle } = await fixture(t)
  await service.ensurePlayer({ userId: 'alice' })
  await settle()
  assert.equal(
    await dispatchPointJob(
      client,
      dependencies({
        claims: async () => {
          throw new PointSyncError('CLERK_PROFILE_UNAVAILABLE', true)
        },
      })
    ),
    'pending'
  )
  assert.equal((await client.execute('SELECT COUNT(*) AS n FROM scolo_zikak_batches')).rows[0]!.n, 0)
  await retryPointJobs(client, START + DAY)
  assert.equal(
    await dispatchPointJob(client, dependencies({ resolve: async (c) => resolution(c.subject_id, false) })),
    'identity_pending'
  )
  assert.equal((await client.execute('SELECT COUNT(*) AS n FROM scolo_zikak_batches')).rows[0]!.n, 0)
})

test('Clerk verification comes from backend status; username is never promoted to a social identity', () => {
  const claims = claimsFromClerk('subject', {
    id: 'user_real',
    username: 'someone',
    emailAddresses: [
      { emailAddress: 'good@example.test', verification: { status: 'verified' } },
      { emailAddress: 'claimed@example.test', verification: { status: 'unverified' } },
    ],
  })
  assert.deepEqual(
    claims.emails.map((e) => e.verified),
    [true, false]
  )
  assert.deepEqual(claims.identities, [])
  assert.equal(claims.username, 'someone')
})

test('transport isolates credentials, bounds its contract and classifies unresolved identities', async () => {
  const config = {
    origin: 'http://localhost:8999',
    applicationId: 'scolo-dev',
    token: 'synthetic-local-only-credential-000000000',
  }
  const payload = JSON.stringify({
    batch_id: 'batch',
    entries: [
      { reference: 'entry', subject_id: 'alice', amount: 3, reason: 'welcome', occurred_at: '2030-01-01T12:00:00Z' },
    ],
  })
  const publish = createPointPublisher(config, async (url, init) => {
    assert.equal(url, config.origin + '/api/integrations/v1/point-batches')
    assert.equal(init?.redirect, 'error')
    assert.equal(init?.body, payload)
    return Response.json(receipt(payload))
  })
  assert.deepEqual(await publish(payload), receipt(payload))
  await assert.rejects(
    createPointPublisher(config, async () => Response.json({ ...receipt(payload), application_id: 'other' }))(payload),
    /INVALID_RECEIPT/
  )
  await assert.rejects(
    createPointPublisher(config, async () =>
      Response.json({ error: 'identity_unresolved', subject_id: 'alice' }, { status: 409 })
    )(payload),
    /IDENTITY_UNRESOLVED/
  )
  const resolver = createSubjectResolver(config, async (_url, init) => {
    assert.equal(init?.redirect, 'error')
    return Response.json(resolution('alice'))
  })
  assert.equal((await resolver.resolve({ subject_id: 'alice', emails: [], identities: [] }))?.can_sync_points, true)
  await assert.rejects(
    createSubjectResolver(config, async () => Response.json(resolution('wrong'))).get('alice'),
    /INVALID_IDENTITY_RESOLUTION/
  )
})

test('DEV, local and future PROD use distinct sources while both hosted services may target Zikak DEV', () => {
  const token = 'synthetic-local-only-credential-000000000'
  const config = {
    SCOLO_WALLET_MODE: 'local' as const,
    SCOLO_ENVIRONMENT: 'dev' as const,
    SCOLO_ZIKAK_SYNC_ENABLED: 'true' as const,
    ZIKAK_API_ORIGIN: 'https://api-zikak-dev.marvinl.com',
    ZIKAK_APPLICATION_ID: 'scolo-dev',
    ZIKAK_INTEGRATION_TOKEN: token,
  }
  assert.equal(pointSyncConfiguration(config)?.applicationId, 'scolo-dev')
  assert.equal(
    pointSyncConfiguration({ ...config, SCOLO_ENVIRONMENT: 'local', ZIKAK_APPLICATION_ID: 'scolo-dev-local' })
      ?.applicationId,
    'scolo-dev-local'
  )
  assert.equal(
    pointSyncConfiguration({
      ...config,
      SCOLO_ENVIRONMENT: 'prod',
      SCOLO_WALLET_MODE: 'scolo',
      ZIKAK_APPLICATION_ID: 'scolo-prod',
    })?.applicationId,
    'scolo-prod'
  )
  assert.throws(() => pointSyncConfiguration({ ...config, ZIKAK_APPLICATION_ID: 'scolo-prod' }))
  assert.throws(() => pointSyncConfiguration({ ...config, ZIKAK_INTEGRATION_TOKEN: '' }))
  assert.throws(() => pointSyncConfiguration({ ...config, ZIKAK_API_ORIGIN: 'https://evil.example' }))
})

test('migration preserves queued V1 payloads and new pending jobs without reseeding', async (t) => {
  const { client, service, settle } = await fixture(t, false)
  await service.ensurePlayer({ userId: 'old' })
  await settle()
  const round = (await service.getPublicGame()).round.id
  const tx = await client.transaction('write')
  await enqueuePointBatches(tx, { roundId: round, applicationId: 'scolo-dev', now: START })
  await tx.commit()
  tx.close()
  const before = (await client.execute('SELECT * FROM scolo_zikak_batches')).rows
  const ledger = (await client.execute('SELECT * FROM scolo_wallet_entries')).rows
  await migrateLocalDatabase(client)
  await migrateLocalDatabase(client)
  assert.deepEqual((await client.execute('SELECT * FROM scolo_zikak_batches')).rows, before)
  assert.deepEqual((await client.execute('SELECT * FROM scolo_wallet_entries')).rows, ledger)
})
