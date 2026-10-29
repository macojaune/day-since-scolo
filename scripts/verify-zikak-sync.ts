import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createClient } from '@libsql/client'
import { createGameService } from '../src/server/game/service'
import { createPointPublisher, dispatchPointBatch, pointSyncSummary, retryPointSync, type PointBatch } from '../src/server/zikak/outbox'

// Explicit integration check against the real Go binary's disposable launcher.
// Never accepts a remote host, deployed token, real game DB or existing identity.
const origin = 'http://127.0.0.1:18088'
const config = { origin, applicationId: 'scolo-dev-e2e-scolo', token: 'synthetic-local-scolo-e2e-only-000000000000' }
const directory = await mkdtemp(join(tmpdir(), 'scolo-zikak-http-'))
const client = createClient({ url: `file:${join(directory, 'scolo.db')}` })
const start = Date.now() - 60_000
let current = start
const run = randomUUID()
try {
  assert.equal((await fetch(`${origin}/api/health`)).status, 200)
  assert.equal((await fetch(`${origin}/api/integrations/v1/point-batches/absent`)).status, 401)
  const service = await createGameService(client, { now: () => new Date(current), zikakApplicationId: config.applicationId })
  const roundId = (await service.getPublicGame()).round.id
  await service.placePrediction({ userId: `synthetic-alice-${run}`, displayName: `Scolo test Alice ${run}`, roundId, predictedAt: new Date(start), stake: 3, idempotencyKey: 'alice' })
  await service.placePrediction({ userId: `synthetic-bob-${run}`, displayName: `Scolo test Bob ${run}`, roundId, predictedAt: new Date(start + 86_400_000), stake: 3, idempotencyKey: 'bob' })
  assert.deepEqual(await pointSyncSummary(client), { sent: 0, pending: 0, blocked: 0 })
  current += 30_000
  const input = { roundId, observedAt: new Date(current - 1000), tool: 'sandale' }
  await service.settleRound(input)
  const row = (await client.execute('SELECT payload FROM scolo_zikak_batches')).rows[0]!
  const payload = String(row.payload)
  const batch = JSON.parse(payload) as PointBatch
  assert.equal(batch.entries.length, 6)
  const realPublish = createPointPublisher(config)
  // Remote accepts, but the caller loses the response. The queue must retain
  // the frozen payload and recover the original receipt on its next attempt.
  let firstReceipt: Awaited<ReturnType<typeof realPublish>> | undefined
  assert.equal(await dispatchPointBatch(client, { applicationId: config.applicationId, publish: async body => {
    firstReceipt = await realPublish(body)
    throw new Error('Synthetic lost response after remote commit')
  } }), 'pending')
  await retryPointSync(client)
  assert.equal(await dispatchPointBatch(client, { applicationId: config.applicationId, publish: realPublish }), 'sent')
  assert.deepEqual(JSON.parse(String((await client.execute('SELECT receipt FROM scolo_zikak_batches')).rows[0]!.receipt)), firstReceipt)
  assert.deepEqual(await realPublish(payload), firstReceipt)
  const headers = { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }
  const stored = await fetch(`${origin}/api/integrations/v1/point-batches/${encodeURIComponent(batch.batch_id)}`, { headers })
  assert.equal(stored.status, 200)
  assert.deepEqual(await stored.json(), firstReceipt)
  assert.equal((await fetch(`${origin}/api/integrations/v1/point-batches`, { method: 'POST', headers, body: JSON.stringify({ ...batch, batch_id: randomUUID() }) })).status, 409)
  assert.equal((await fetch(`${origin}/api/integrations/v1/point-batches`, { method: 'POST', headers, body: JSON.stringify({ ...batch, entries: batch.entries.map((entry, index) => index ? entry : { ...entry, amount: 9 }) }) })).status, 409)
  // The business read API is used only on the launcher's temporary DB and its
  // explicit synthetic admin credential. Production credentials are never read.
  const memberResponse = await fetch(`${origin}/api/members`, { headers: { Authorization: 'Bearer synthetic-local-business-e2e-only-000000000000' } })
  assert.equal(memberResponse.status, 200)
  const members = await memberResponse.json() as { member: { id: string; display_name: string }; balance: number }[]
  const list = members.filter(item => item.member.display_name.endsWith(run))
  assert.equal(list.length, 2)
  const balances: number[] = []
  for (const item of list) {
    const response = await fetch(`${origin}/api/members/${item.member.id}`, { headers: { Authorization: 'Bearer synthetic-local-business-e2e-only-000000000000' } })
    assert.equal(response.status, 200)
    const balance = await response.json() as { balance: number }
    balances.push(balance.balance)
  }
  assert.deepEqual(balances.sort((a, b) => a - b), [2, 6])
  await service.settleRound(input)
  assert.deepEqual(await pointSyncSummary(client), { sent: 1, pending: 0, blocked: 0 })
  console.log(JSON.stringify({ success: true, target: origin, entries: batch.entries.length, balances: [2, 6], checks: ['no batch on vote', 'settlement snapshot', 'real Go HTTP', 'lost response recovery', 'identical durable receipt', 'cross-batch duplication refused', 'mutated batch refused', 'balances conserved after retries', 'repeated settlement enqueues once'], disposableScoloDatabase: true }, null, 2))
} finally {
  client.close()
  await rm(directory, { recursive: true, force: true })
}
