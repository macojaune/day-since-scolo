import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { createClient } from '@libsql/client'
import { migrateLocalDatabase } from '../src/server/db/local-migrations'
import { createGameService } from '../src/server/game/service'
import { calculateSettlement } from '../src/server/game/settlement'
import { seedLocalDemo } from '../src/server/game/seed-local'
import { GameError } from '../src/server/game/types'

const START = Date.parse('2030-01-01T12:00:00.000Z')
const HOUR = 3_600_000
const DAY = 24 * HOUR

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'scolo-game-test-'))
  const client = createClient({ url: `file:${join(directory, 'test.db')}` })
  t.after(async () => { client.close(); await rm(directory, { recursive: true, force: true }) })
  let current = START
  let sequence = 0
  const service = await createGameService(client, { now: () => new Date(current), id: () => `id-${String(++sequence).padStart(6, '0')}` })
  const roundId = (await service.getPublicGame()).round.id
  return { client, service, roundId, time: (value: number) => { current = value } }
}

const gameError = (code: string) => (error: unknown) => error instanceof GameError && error.code === code

test('public history preserves older years beyond one hundred encounters', async t => {
  const { service, client } = await fixture(t)
  const encounters = Array.from({ length: 103 }, (_, index) => ({
    id: index + 1,
    occurredAt: new Date(Date.UTC(2020, index, 15, 12)),
  }))
  await client.batch(encounters.map(encounter => ({
    sql: 'INSERT INTO "scolo-data" (id, created_at, tool) VALUES (?, ?, ?)',
    args: [encounter.id, encounter.occurredAt.getTime() / 1000, 'sandale'],
  })), 'write')

  const game = await service.getPublicGame()
  assert.deepEqual(game.history.map(appearance => appearance.id), encounters.map(encounter => encounter.id).reverse())
  assert.equal(game.history.at(-1)?.occurredAt, '2020-01-15T12:00:00.000Z')
  assert.equal(game.lastAppearance?.occurredAt, encounters.at(-1)!.occurredAt.toISOString())
})

test('welcome bonus is persisted once, including concurrent sign-ins', async t => {
  const { service, client } = await fixture(t)
  await Promise.all(Array.from({ length: 12 }, () => service.ensurePlayer({ userId: 'clerk-alice', displayName: 'Alice' })))
  assert.equal((await service.getPlayerGame('clerk-alice')).balance, 3)
  assert.equal((await client.execute("SELECT COUNT(*) AS total FROM scolo_wallet_entries WHERE kind = 'welcome'")).rows[0]!.total, 1)
  await assert.rejects(service.getPlayerGame('someone-else'), gameError('PLAYER_NOT_FOUND'))
})

test('concurrent different stakes cannot spend the same last points', async t => {
  const { service, roundId } = await fixture(t)
  await service.ensurePlayer({ userId: 'alice' })
  const attempts = await Promise.allSettled(['one', 'two'].map(idempotencyKey => service.placePrediction({ userId: 'alice', roundId, predictedAt: new Date(START + HOUR), stake: 2, idempotencyKey })))
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1)
  const failure = attempts.find(result => result.status === 'rejected') as PromiseRejectedResult
  assert.equal((failure.reason as GameError).code, 'INSUFFICIENT_BALANCE')
  assert.deepEqual((await service.getPlayerGame('alice')).predictions.map(ticket => ticket.stake), [2])
  assert.equal((await service.getPlayerGame('alice')).balance, 1)
  assert.equal((await service.getPublicGame()).round.pot, 2)
})

test('a confirmation retry returns the original ticket and never debits twice', async t => {
  const { service, roundId, time } = await fixture(t)
  const input = { userId: 'alice', roundId, predictedAt: new Date(START + HOUR), stake: 2, idempotencyKey: 'retry' }
  const results = await Promise.all([service.placePrediction(input), service.placePrediction(input)])
  assert.equal(results[0]!.prediction.id, results[1]!.prediction.id)
  assert.equal((await service.getPlayerGame('alice')).balance, 1)
  await assert.rejects(service.placePrediction({ ...input, stake: 1 }), gameError('IDEMPOTENCY_CONFLICT'))
  time(START + 2 * HOUR)
  assert.equal((await service.placePrediction(input)).prediction.id, results[0]!.prediction.id)
})

test('invalid dates, amounts and stale rounds leave the wallet untouched', async t => {
  const { service, roundId, time } = await fixture(t)
  await service.ensurePlayer({ userId: 'alice' })
  const input = { userId: 'alice', roundId, predictedAt: new Date(START + HOUR), stake: 1, idempotencyKey: 'invalid' }
  for (const stake of [0, -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(service.placePrediction({ ...input, stake }), gameError('INVALID_INPUT'))
  }
  for (const predictedAt of [new Date(START - DAY), new Date('2030-01-01T03:59:59.999Z'), new Date(NaN)]) {
    await assert.rejects(service.placePrediction({ ...input, predictedAt }), gameError('INVALID_INPUT'))
  }
  await assert.rejects(service.placePrediction({ ...input, stake: 4 }), gameError('INSUFFICIENT_BALANCE'))
  assert.equal((await service.getPlayerGame('alice')).balance, 3)
  assert.equal((await service.getPublicGame()).round.pot, 0)
  time(START + HOUR)
  await service.settleRound({ roundId, observedAt: new Date(START + 1000), tool: 'sandale' })
  await assert.rejects(service.placePrediction({ ...input, predictedAt: new Date(START + 3 * HOUR) }), gameError('ROUND_CLOSED'))
})

test('date groups expose aggregate odds, never identity or email', async t => {
  const { service, roundId } = await fixture(t)
  await service.placePrediction({ userId: 'secret-clerk-id-a', roundId, predictedAt: new Date(START + HOUR), stake: 2, idempotencyKey: 'a' })
  await service.placePrediction({ userId: 'secret-clerk-id-b', roundId, predictedAt: new Date(START + HOUR), stake: 1, idempotencyKey: 'b' })
  await service.placePrediction({ userId: 'secret-clerk-id-c', roundId, predictedAt: new Date(START + DAY), stake: 3, idempotencyKey: 'c' })
  const publicGame = await service.getPublicGame()
  assert.equal(publicGame.round.pot, 6)
  assert.equal(publicGame.round.participantCount, 3)
  assert.equal(publicGame.round.groups.length, 2)
  assert.deepEqual(publicGame.round.groups.map(group => [group.totalStake, group.odds]), [[3, 2], [3, 2]])
  assert.ok(!JSON.stringify(publicGame).includes('secret-clerk-id'))
})

test('today is playable and stored as a date, while yesterday is refused', async t => {
  const { service, roundId } = await fixture(t)
  const input = { userId: 'alice', roundId, stake: 1, idempotencyKey: 'today' }
  // The selected day's midnight has already passed; it remains a valid date.
  const result = await service.placePrediction({ ...input, predictedAt: new Date('2030-01-01T04:00:00.000Z') })
  assert.equal(result.prediction.predictedAt, '2030-01-01T04:00:00.000Z')
  const retry = await service.placePrediction({ ...input, predictedAt: new Date('2030-01-02T03:59:59.999Z') })
  assert.equal(retry.prediction.id, result.prediction.id)
  assert.equal((await service.getPlayerGame('alice')).balance, 2)
  await assert.rejects(service.placePrediction({ ...input, idempotencyKey: 'past', predictedAt: new Date('2030-01-01T03:59:59.999Z') }), gameError('INVALID_INPUT'))
  await assert.rejects(service.placePrediction({ ...input, predictedAt: new Date('2030-01-02T04:00:00.000Z') }), gameError('IDEMPOTENCY_CONFLICT'))
})

test('the current playable date changes at Guadeloupe midnight, not UTC midnight', async t => {
  const { service, roundId, time } = await fixture(t)
  const input = { userId: 'alice', roundId, stake: 1, idempotencyKey: 'before-midnight' }
  time(Date.parse('2030-01-02T03:59:59.999Z'))
  const before = await service.placePrediction({ ...input, predictedAt: new Date('2030-01-02T00:00:00.000Z') })
  assert.equal(before.prediction.predictedAt, '2030-01-01T04:00:00.000Z')
  time(Date.parse('2030-01-02T04:00:00.000Z'))
  await assert.rejects(service.placePrediction({ ...input, idempotencyKey: 'past-now', predictedAt: new Date('2030-01-02T03:59:59.999Z') }), gameError('INVALID_INPUT'))
  const after = await service.placePrediction({ ...input, idempotencyKey: 'after-midnight', predictedAt: new Date('2030-01-02T04:00:00.000Z') })
  assert.equal(after.prediction.predictedAt, '2030-01-02T04:00:00.000Z')
  // Retrying an already accepted ticket after its date passed must not debit again.
  assert.equal((await service.placePrediction({ ...input, predictedAt: new Date('2030-01-01T04:00:00.000Z') })).prediction.id, before.prediction.id)
  assert.equal((await service.getPlayerGame('alice')).balance, 1)
})

test('legacy timestamps on the same day share odds and wins without rewriting their records', async t => {
  const { service, client, roundId, time } = await fixture(t)
  const alice = await service.placePrediction({ userId: 'alice', displayName: 'Alice', roundId, predictedAt: new Date(START + DAY), stake: 2, idempotencyKey: 'a' })
  const bob = await service.placePrediction({ userId: 'bob', displayName: 'Bob', roundId, predictedAt: new Date(START + DAY), stake: 1, idempotencyKey: 'b' })
  await service.placePrediction({ userId: 'carol', displayName: 'Carol', roundId, predictedAt: new Date(START + 3 * DAY), stake: 3, idempotencyKey: 'c' })
  const oldAlice = Date.parse('2030-01-02T04:05:00.000Z')
  const oldBob = Date.parse('2030-01-03T03:55:00.000Z')
  await client.batch([
    { sql: 'UPDATE scolo_predictions SET predicted_at = ? WHERE id = ?', args: [oldAlice, alice.prediction.id] },
    { sql: 'UPDATE scolo_predictions SET predicted_at = ? WHERE id = ?', args: [oldBob, bob.prediction.id] },
  ], 'write')
  const game = await service.getPublicGame()
  assert.deepEqual(game.round.groups.map(group => [group.predictedAt, group.totalStake, group.predictionCount, group.odds]), [
    ['2030-01-02T04:00:00.000Z', 3, 2, 2],
    ['2030-01-04T04:00:00.000Z', 3, 1, 2],
  ])
  time(START + 2 * DAY)
  const result = await service.settleRound({ roundId, observedAt: new Date('2030-01-02T23:30:00.000Z'), tool: 'sandale' })
  assert.equal(result.winningDistanceMs, 0)
  assert.deepEqual(result.entries.map(entry => [entry.playerName, entry.outcome, entry.payout]), [['Alice', 'won', 4], ['Bob', 'won', 2], ['Carol', 'lost', 0]])
  const records = (await client.execute({ sql: 'SELECT id, predicted_at FROM scolo_predictions WHERE id IN (?, ?) ORDER BY id', args: [alice.prediction.id, bob.prediction.id] })).rows
  assert.deepEqual(records.map(row => Number(row.predicted_at)), [oldAlice, oldBob])
})

test('closest civil date wins irrespective of stake size, settlement is idempotent', async t => {
  const { service, client, roundId, time } = await fixture(t)
  await service.placePrediction({ userId: 'alice', displayName: 'Alice', roundId, predictedAt: new Date(START + DAY), stake: 1, idempotencyKey: 'alice' })
  await service.placePrediction({ userId: 'bob', displayName: 'Bob', roundId, predictedAt: new Date(START + 4 * DAY), stake: 3, idempotencyKey: 'bob' })
  time(START + 2 * DAY)
  const input = { roundId, observedAt: new Date(START + DAY + 10 * 60_000), tool: 'coutelas' }
  const preview = await service.previewSettlement(input)
  assert.equal(preview.pot, 4)
  assert.equal(preview.winningDistanceMs, 0)
  assert.equal(preview.entries.find(entry => entry.playerName === 'Alice')?.payout, 4)
  assert.equal((await service.getPlayerGame('alice')).balance, 2)
  const [first, retry] = await Promise.all([service.settleRound(input), service.settleRound(input)])
  assert.deepEqual(first, retry)
  assert.equal((await service.getPlayerGame('alice')).balance, 6)
  assert.equal((await service.getPlayerGame('bob')).balance, 2)
  assert.deepEqual(first.replayBonuses, [{ playerName: 'Bob', amount: 2 }])
  assert.equal(first.totalReplayBonus, 2)
  assert.equal((await service.getPlayerGame('alice')).committed, 0)
  assert.equal((await client.execute('SELECT COUNT(*) AS total FROM scolo_settlements')).rows[0]!.total, 1)
  assert.equal((await client.execute('SELECT COUNT(*) AS total FROM "scolo-data"')).rows[0]!.total, 1)
  const game = await service.getPublicGame()
  assert.equal(game.round.id, first.nextRoundId)
  assert.equal(game.round.openedAt, new Date(START + 2 * DAY).toISOString())
  assert.equal(game.lastAppearance!.occurredAt, input.observedAt.toISOString())
  assert.deepEqual(game.recentResult, first)
  await assert.rejects(service.settleRound({ ...input, tool: 'sandale' }), gameError('IDEMPOTENCY_CONFLICT'))
  // A result recorded under the former time-based rule is read as recorded,
  // never rescored by the new rule or paid a second time.
  await client.execute({ sql: 'UPDATE scolo_settlements SET winning_distance_ms = ? WHERE round_id = ?', args: [17 * 60_000, roundId] })
  assert.equal((await service.getPublicGame()).recentResult!.winningDistanceMs, 17 * 60_000)
  assert.equal((await service.settleRound(input)).winningDistanceMs, 17 * 60_000)
  assert.equal((await service.getPlayerGame('alice')).balance, 6)
})

test('tickets registered at or after a late-declared observation are refunded', async t => {
  const { service, roundId, time } = await fixture(t)
  await service.placePrediction({ userId: 'early', roundId, predictedAt: new Date(START + 3 * HOUR), stake: 2, idempotencyKey: 'early' })
  time(START + HOUR)
  await service.placePrediction({ userId: 'boundary', roundId, predictedAt: new Date(START + 3 * HOUR), stake: 3, idempotencyKey: 'boundary' })
  time(START + 2 * HOUR)
  await service.placePrediction({ userId: 'late', roundId, predictedAt: new Date(START + 3 * HOUR), stake: 1, idempotencyKey: 'late' })
  time(START + 4 * HOUR)
  const result = await service.settleRound({ roundId, observedAt: new Date(START + HOUR), tool: 'sandale' })
  assert.equal(result.pot, 2)
  assert.equal(result.totalRefunded, 4)
  assert.equal(result.entries.filter(entry => entry.outcome === 'refunded').length, 2)
  for (const userId of ['early', 'boundary', 'late']) assert.equal((await service.getPlayerGame(userId)).balance, 3)
})

test('equidistant civil days before and after the observation share the pot by stake', async t => {
  const { service, roundId, time } = await fixture(t)
  await service.placePrediction({ userId: 'alice', displayName: 'Alice', roundId, predictedAt: new Date(START + DAY), stake: 2, idempotencyKey: 'a' })
  await service.placePrediction({ userId: 'bob', displayName: 'Bob', roundId, predictedAt: new Date(START + 3 * DAY), stake: 1, idempotencyKey: 'b' })
  await service.placePrediction({ userId: 'carol', displayName: 'Carol', roundId, predictedAt: new Date(START + 8 * DAY), stake: 2, idempotencyKey: 'c' })
  time(START + 4 * DAY)
  const result = await service.settleRound({ roundId, observedAt: new Date(START + 2 * DAY + 11 * HOUR), tool: 'digrain' })
  assert.equal(result.pot, 5)
  assert.equal(result.winningDistanceMs, DAY)
  assert.deepEqual(result.entries.map(entry => [entry.playerName, entry.outcome, entry.payout]), [['Alice', 'won', 3], ['Bob', 'won', 2], ['Carol', 'lost', 0]])
  assert.equal(result.entries.reduce((sum, entry) => sum + entry.payout, 0), 5)
  assert.equal((await service.getPlayerGame('alice')).balance + (await service.getPlayerGame('bob')).balance + (await service.getPlayerGame('carol')).balance, 9 + result.totalReplayBonus)
})

test('all-refunded and empty rounds settle without inventing a winner', async t => {
  const { service, roundId, time } = await fixture(t)
  time(START + HOUR)
  await service.placePrediction({ userId: 'late', roundId, predictedAt: new Date(START + 3 * HOUR), stake: 3, idempotencyKey: 'late' })
  const result = await service.settleRound({ roundId, observedAt: new Date(START + 1), tool: 'capes' })
  assert.equal(result.pot, 0)
  assert.equal(result.winningDistanceMs, null)
  assert.equal(result.totalRefunded, 3)
  assert.equal((await service.getPlayerGame('late')).balance, 3)
  assert.equal(result.totalReplayBonus, 0)
  assert.deepEqual(result.replayBonuses, [])
  time(START + 2 * HOUR)
  const empty = await service.settleRound({ roundId: result.nextRoundId!, observedAt: new Date(START + HOUR + 1), tool: 'capes' })
  assert.deepEqual(empty.entries, [])
  assert.equal(empty.pot, 0)
  assert.equal(empty.totalReplayBonus, 0)
})

test('invalid settlement or rollback cannot modify balances and tickets', async t => {
  const { service, client, roundId, time } = await fixture(t)
  await service.placePrediction({ userId: 'alice', roundId, predictedAt: new Date(START + HOUR), stake: 1, idempotencyKey: 'a' })
  await service.placePrediction({ userId: 'bob', roundId, predictedAt: new Date(START + 3 * DAY), stake: 3, idempotencyKey: 'b' })
  time(START + 2 * HOUR)
  await assert.rejects(service.settleRound({ roundId, observedAt: new Date(START), tool: 'sandale' }), gameError('INVALID_INPUT'))
  await assert.rejects(service.settleRound({ roundId, observedAt: new Date(START + 3 * HOUR), tool: 'sandale' }), gameError('INVALID_INPUT'))
  await client.execute("CREATE TRIGGER fail_history BEFORE INSERT ON \"scolo-data\" BEGIN SELECT RAISE(ABORT, 'test failure'); END")
  await assert.rejects(service.settleRound({ roundId, observedAt: new Date(START + HOUR), tool: 'sandale' }))
  assert.equal((await service.getPlayerGame('alice')).balance, 2)
  assert.equal((await service.getPlayerGame('bob')).balance, 0)
  assert.equal((await client.execute("SELECT COUNT(*) AS total FROM scolo_wallet_entries WHERE kind = 'round_bonus'")).rows[0]!.total, 0)
  assert.equal((await service.getPlayerGame('alice')).predictions[0]!.status, 'active')
  assert.equal((await service.getPublicGame()).round.id, roundId)
  assert.equal((await client.execute('SELECT COUNT(*) AS total FROM scolo_settlements')).rows[0]!.total, 0)
})

test('rounding is exact near the safe-integer boundary', () => {
  const amount = Number.MAX_SAFE_INTEGER - 2
  const result = calculateSettlement([
    { id: 'a', playerId: 'a', playerName: 'A', stake: amount, createdAt: START, predictedAt: START + DAY },
    { id: 'b', playerId: 'b', playerName: 'B', stake: 1, createdAt: START, predictedAt: START + DAY },
    { id: 'c', playerId: 'c', playerName: 'C', stake: 1, createdAt: START, predictedAt: START + 9 * DAY },
  ], START + DAY)
  assert.equal(result.entries.reduce((sum, entry) => sum + BigInt(entry.payout), 0n), BigInt(Number.MAX_SAFE_INTEGER))
})

test('only losing participants with zero balance after refunds get two replay points', async t => {
  const { service, client, roundId, time } = await fixture(t)
  const bet = (userId: string, day: number, idempotencyKey: string) => service.placePrediction({
    userId, displayName: userId, roundId, predictedAt: new Date(START + day * DAY), stake: 1, idempotencyKey,
  })
  await bet('winner', 1, 'winning')
  await bet('winner', 8, 'losing')
  await bet('loser', 8, 'first')
  await bet('loser', 9, 'second')
  await bet('loser', 10, 'third')
  await bet('loser-with-refund', 7, 'eligible')
  await service.placePrediction({ userId: 'has-one', displayName: 'has-one', roundId, predictedAt: new Date(START + 7 * DAY), stake: 2, idempotencyKey: 'eligible' })
  await service.ensurePlayer({ userId: 'inactive' })
  const observedAt = new Date(START + DAY)
  time(observedAt.getTime())
  await bet('refund-only', 5, 'late')
  await service.placePrediction({ userId: 'loser-with-refund', roundId, predictedAt: new Date(START + 6 * DAY), stake: 2, idempotencyKey: 'late' })
  assert.equal((await service.getPlayerGame('loser-with-refund')).balance, 0)
  time(START + DAY + HOUR)
  const input = { roundId, observedAt, tool: 'sandale' }
  const preview = await service.previewSettlement(input)
  assert.equal(preview.pot, 8)
  assert.equal(preview.totalRefunded, 3)
  assert.equal(preview.totalReplayBonus, 2)
  assert.deepEqual(preview.replayBonuses, [{ playerName: 'loser', amount: 2 }])
  assert.equal((await service.getPlayerGame('loser')).balance, 0)
  assert.equal((await client.execute("SELECT COUNT(*) AS total FROM scolo_wallet_entries WHERE kind = 'round_bonus'")).rows[0]!.total, 0)

  const results = await Promise.all(Array.from({ length: 8 }, () => service.settleRound(input)))
  for (const result of results) assert.deepEqual(result, results[0])
  assert.deepEqual(results[0], { ...preview, nextRoundId: results[0]!.nextRoundId, appearanceId: results[0]!.appearanceId })
  const balances: Record<string, number> = { winner: 9, loser: 2, 'loser-with-refund': 2, 'has-one': 1, 'refund-only': 3, inactive: 3 }
  for (const [userId, balance] of Object.entries(balances)) assert.equal((await service.getPlayerGame(userId)).balance, balance)
  const ledger = (await client.execute("SELECT amount FROM scolo_wallet_entries WHERE kind = 'round_bonus'")).rows
  assert.deepEqual(ledger.map(entry => entry.amount), [2])
  assert.equal(results[0]!.entries.filter(entry => entry.outcome === 'won').reduce((sum, entry) => sum + entry.payout, 0), preview.pot)
  assert.equal((await client.execute('SELECT SUM(balance) AS total FROM scolo_wallets')).rows[0]!.total, 18 + preview.totalReplayBonus)
  assert.equal((await client.execute('SELECT SUM(amount) AS total FROM scolo_wallet_entries')).rows[0]!.total, 18 + preview.totalReplayBonus)
})

test('a losing player can earn one new replay bonus in each subsequent played round', async t => {
  const { service, client, roundId, time } = await fixture(t)
  let currentRound = roundId
  for (let round = 0; round < 2; round++) {
    const current = START + round * DAY
    await service.placePrediction({ userId: 'winner', roundId: currentRound, predictedAt: new Date(current), stake: 1, idempotencyKey: 'winner' })
    await service.placePrediction({ userId: 'loser', roundId: currentRound, predictedAt: new Date(current + 4 * DAY), stake: round === 0 ? 3 : 2, idempotencyKey: 'loser' })
    time(current + DAY)
    const result = await service.settleRound({ roundId: currentRound, observedAt: new Date(current + HOUR), tool: 'sandale' })
    assert.equal(result.totalReplayBonus, 2)
    assert.equal((await service.getPlayerGame('loser')).balance, 2)
    currentRound = result.nextRoundId!
  }
  assert.equal((await client.execute("SELECT COUNT(*) AS total FROM scolo_wallet_entries WHERE kind = 'round_bonus'")).rows[0]!.total, 2)
})

test('a losing participant with a large remaining balance receives no replay bonus', async t => {
  const { service, client, roundId, time } = await fixture(t)
  await service.placePrediction({ userId: 'winner', roundId, predictedAt: new Date(START + DAY), stake: 1, idempotencyKey: 'winner' })
  await service.placePrediction({ userId: 'loser', roundId, predictedAt: new Date(START + 4 * DAY), stake: 1, idempotencyKey: 'loser' })
  await client.execute({ sql: 'UPDATE scolo_wallets SET balance = ? WHERE player_id = (SELECT id FROM scolo_players WHERE clerk_user_id = ?)', args: [Number.MAX_SAFE_INTEGER - 1, 'loser'] })
  time(START + DAY)
  const result = await service.settleRound({ roundId, observedAt: new Date(START + HOUR), tool: 'sandale' })
  assert.equal(result.totalReplayBonus, 0)
  assert.equal((await service.getPlayerGame('winner')).balance, 4)
  assert.equal((await service.getPlayerGame('loser')).balance, Number.MAX_SAFE_INTEGER - 1)
  assert.equal((await client.execute("SELECT COUNT(*) AS total FROM scolo_wallet_entries WHERE kind = 'round_bonus'")).rows[0]!.total, 0)
})

test('wallet migration preserves populated data, indexes, triggers and references and is repeatable', async t => {
  const { service, client, roundId, time } = await fixture(t)
  await service.placePrediction({ userId: 'alice', roundId, predictedAt: new Date(START + DAY), stake: 1, idempotencyKey: 'a' })
  await service.placePrediction({ userId: 'bob', roundId, predictedAt: new Date(START + 4 * DAY), stake: 3, idempotencyKey: 'b' })
  await client.batch([
    `CREATE TABLE old_wallet_entries (
      id TEXT PRIMARY KEY NOT NULL,
      player_id TEXT NOT NULL REFERENCES scolo_players(id),
      amount INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('welcome', 'reserve', 'payout', 'refund', 'fixture')),
      reference TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    )`,
    'INSERT INTO old_wallet_entries SELECT * FROM scolo_wallet_entries',
    'DROP TABLE scolo_wallet_entries',
    'ALTER TABLE old_wallet_entries RENAME TO scolo_wallet_entries',
    'CREATE INDEX scolo_wallet_kind_legacy ON scolo_wallet_entries(kind)',
    'CREATE TABLE migration_audit (reference TEXT NOT NULL)',
    'CREATE TRIGGER wallet_audit AFTER INSERT ON scolo_wallet_entries BEGIN INSERT INTO migration_audit (reference) VALUES (NEW.reference); END',
  ], 'write')
  const tables = ['scolo_players', 'scolo_wallets', 'scolo_predictions', 'scolo_wallet_entries', 'scolo_rounds', 'scolo_settlements']
  const before = await Promise.all(tables.map(table => client.execute(`SELECT * FROM ${table} ORDER BY rowid`)))
  await migrateLocalDatabase(client)
  await migrateLocalDatabase(client)
  const after = await Promise.all(tables.map(table => client.execute(`SELECT * FROM ${table} ORDER BY rowid`)))
  assert.deepEqual(after.map(result => result.rows), before.map(result => result.rows))
  assert.equal((await client.execute("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'index' AND name = 'scolo_wallet_kind_legacy'")).rows[0]!.total, 1)
  assert.equal((await client.execute("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'trigger' AND name = 'wallet_audit'")).rows[0]!.total, 1)
  assert.deepEqual((await client.execute('SELECT * FROM migration_audit')).rows, [])
  assert.deepEqual((await client.execute('PRAGMA foreign_key_check')).rows, [])
  const definition = (await client.execute("SELECT sql FROM sqlite_master WHERE name = 'scolo_wallet_entries'")).rows[0]!.sql
  assert.ok(String(definition).includes("'round_bonus'"))
  time(START + 2 * DAY)
  const result = await service.settleRound({ roundId, observedAt: new Date(START + DAY), tool: 'sandale' })
  assert.equal(result.totalReplayBonus, 2)
  assert.equal((await service.getPlayerGame('bob')).balance, 2)
  assert.equal((await client.execute('SELECT COUNT(*) AS total FROM migration_audit')).rows[0]!.total, 2)
})

test('stored historical settlements are never retroactively credited a replay bonus', async t => {
  const { service, client, roundId, time } = await fixture(t)
  await service.placePrediction({ userId: 'winner', roundId, predictedAt: new Date(START + DAY), stake: 1, idempotencyKey: 'winner' })
  await service.placePrediction({ userId: 'loser', roundId, predictedAt: new Date(START + 4 * DAY), stake: 3, idempotencyKey: 'loser' })
  time(START + 2 * DAY)
  const input = { roundId, observedAt: new Date(START + DAY), tool: 'sandale' }
  await service.settleRound(input)
  // Recreate a result persisted by the previous rule, before replay bonuses existed.
  await client.batch([
    "DELETE FROM scolo_wallet_entries WHERE kind = 'round_bonus'",
    "UPDATE scolo_wallets SET balance = 0 WHERE player_id = (SELECT id FROM scolo_players WHERE clerk_user_id = 'loser')",
  ], 'write')
  const original = await service.settleRound(input)
  assert.deepEqual(original.replayBonuses, [])
  assert.equal(original.totalReplayBonus, 0)
  assert.equal((await service.getPlayerGame('loser')).balance, 0)
  assert.deepEqual((await service.getPublicGame()).recentResult, original)
})

test('bootstrap keeps historical tables and never imports legacy credit', async t => {
  const { service, client } = await fixture(t)
  await client.batch([
    'CREATE TABLE credits (id INTEGER PRIMARY KEY, userId TEXT, newCredit INTEGER)',
    "INSERT INTO credits (id, userId, newCredit) VALUES (77, 'alice', 999)",
    'CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT)',
    "INSERT INTO user (id, email) VALUES ('legacy-identity', 'legacy@example.invalid')",
    "INSERT INTO \"scolo-data\" (id, created_at, tool) VALUES (888, 1700000000, 'sandale')",
  ], 'write')
  await createGameService(client)
  await service.ensurePlayer({ userId: 'alice' })
  assert.equal((await service.getPlayerGame('alice')).balance, 3)
  assert.equal((await client.execute('SELECT newCredit FROM credits WHERE id = 77')).rows[0]!.newCredit, 999)
  assert.equal((await client.execute("SELECT email FROM user WHERE id = 'legacy-identity'")).rows[0]!.email, 'legacy@example.invalid')
  assert.equal((await service.getPublicGame()).history[0]!.id, 888)
})

test('demo seeding is labelled, repeatable and refuses an already used store', async t => {
  const { client, service } = await fixture(t)
  assert.equal((await seedLocalDemo(client, new Date(START))).status, 'seeded')
  assert.equal((await seedLocalDemo(client, new Date(START))).status, 'already-seeded')
  const game = await service.getPublicGame()
  assert.equal(game.round.pot, 60)
  assert.equal(game.history.length, 3)
  assert.equal(game.isSimulated, true)
  assert.equal((await client.execute("SELECT COUNT(*) AS total FROM scolo_wallet_entries WHERE kind = 'fixture'")).rows[0]!.total, 3)
})

test('demo seeding never resets existing user points', async t => {
  const { client, service } = await fixture(t)
  await service.ensurePlayer({ userId: 'alice' })
  assert.equal((await seedLocalDemo(client)).status, 'not-empty')
  assert.equal((await service.getPlayerGame('alice')).balance, 3)
  assert.equal((await service.getPublicGame()).history.length, 0)
})

test('a second historical appearance preserves the settled result and the new active game', async t => {
  const { service, client, roundId, time } = await fixture(t)
  await service.placePrediction({ userId: 'winner', roundId, predictedAt: new Date(START), stake: 1, idempotencyKey: 'winner' })
  await service.placePrediction({ userId: 'loser', roundId, predictedAt: new Date(START + 4 * DAY), stake: 3, idempotencyKey: 'loser' })
  time(START + 3 * HOUR)
  const settled = await service.settleRound({ roundId, observedAt: new Date(START + HOUR), tool: 'sandale' })
  await service.placePrediction({ userId: 'new-round', roundId: settled.nextRoundId!, predictedAt: new Date(START + DAY), stake: 2, idempotencyKey: 'next' })
  const tables = ['scolo_players', 'scolo_wallets', 'scolo_wallet_entries', 'scolo_rounds', 'scolo_predictions', 'scolo_settlements']
  const snapshot = () => Promise.all(tables.map(async table => (await client.execute(`SELECT * FROM ${table} ORDER BY rowid`)).rows))
  const before = await snapshot()
  const input = { observedAt: new Date(START + HOUR + 20 * 60_000), tool: 'coutelas', actorUserId: 'admin', idempotencyKey: 'historical-second' }
  const [appearance, retry] = await Promise.all([service.addHistoricalAppearance(input), service.addHistoricalAppearance(input)])
  assert.deepEqual(appearance, retry)
  assert.deepEqual(await snapshot(), before)
  const game = await service.getPublicGame()
  assert.equal(game.round.id, settled.nextRoundId)
  assert.equal(game.round.pot, 2)
  assert.equal(game.lastAppearance?.occurredAt, input.observedAt.toISOString())
  assert.equal(game.history.length, 2)
  assert.deepEqual(game.recentResult, settled)
  assert.equal((await client.execute('SELECT COUNT(*) AS total FROM scolo_history_additions')).rows[0]!.total, 1)
  await assert.rejects(service.addHistoricalAppearance({ ...input, tool: 'sandale' }), gameError('IDEMPOTENCY_CONFLICT'))
  await assert.rejects(service.addHistoricalAppearance({ ...input, actorUserId: 'other-admin' }), gameError('IDEMPOTENCY_CONFLICT'))
  await assert.rejects(service.addHistoricalAppearance({ ...input, observedAt: new Date(START + HOUR + 1) }), gameError('IDEMPOTENCY_CONFLICT'))
  await assert.rejects(service.addHistoricalAppearance({ ...input, idempotencyKey: 'other-confirmation' }), gameError('INVALID_INPUT'))
  assert.deepEqual(await snapshot(), before)
})

test('historical additions reject future/current-round observations and preserve legacy duplicates', async t => {
  const { service, client, time } = await fixture(t)
  const input = { observedAt: new Date(START - DAY), tool: 'sandale', actorUserId: 'admin', idempotencyKey: 'historical-old' }
  await client.batch([
    { sql: 'INSERT INTO "scolo-data" (created_at,tool) VALUES (?,?)', args: [(START - DAY) / 1000, 'sandale'] },
    { sql: 'INSERT INTO "scolo-data" (created_at,tool) VALUES (?,?)', args: [(START - DAY) / 1000, 'coutelas'] },
  ], 'write')
  await assert.rejects(service.addHistoricalAppearance(input), gameError('INVALID_INPUT'))
  await assert.rejects(service.addHistoricalAppearance({ ...input, observedAt: new Date(START + HOUR) }), gameError('INVALID_INPUT'))
  time(START + 2 * HOUR)
  await assert.rejects(service.addHistoricalAppearance({ ...input, observedAt: new Date(START + HOUR) }), gameError('INVALID_INPUT'))
  await assert.rejects(service.addHistoricalAppearance({ ...input, observedAt: new Date(NaN) }), gameError('INVALID_INPUT'))
  await assert.rejects(service.addHistoricalAppearance({ ...input, observedAt: new Date(START - 2 * DAY), tool: 'invented' }), gameError('INVALID_INPUT'))
  const appearance = await service.addHistoricalAppearance({ ...input, observedAt: new Date(START) })
  assert.equal(appearance.occurredAt, new Date(START).toISOString())
  const rows = (await client.execute('SELECT created_at,tool FROM "scolo-data" ORDER BY id')).rows
  assert.deepEqual(rows.slice(0, 2).map(row => row.tool), ['sandale', 'coutelas'])
  assert.equal(rows.length, 3)
  assert.equal((await client.execute('SELECT COUNT(*) AS total FROM scolo_settlements')).rows[0]!.total, 0)
})

test('history insert and idempotency record roll back together', async t => {
  const { service, client } = await fixture(t)
  const input = { observedAt: new Date(START - DAY), tool: 'sandale', actorUserId: 'admin', idempotencyKey: 'atomic-history' }
  await client.execute("CREATE TRIGGER fail_history_receipt BEFORE INSERT ON scolo_history_additions BEGIN SELECT RAISE(ABORT, 'test failure'); END")
  await assert.rejects(service.addHistoricalAppearance(input))
  assert.equal((await client.execute('SELECT COUNT(*) AS total FROM "scolo-data"')).rows[0]!.total, 0)
  assert.equal((await client.execute('SELECT COUNT(*) AS total FROM scolo_history_additions')).rows[0]!.total, 0)
  await client.execute('DROP TRIGGER fail_history_receipt')
  await service.addHistoricalAppearance(input)
  assert.equal((await client.execute('SELECT COUNT(*) AS total FROM "scolo-data"')).rows[0]!.total, 1)
})

test('public mode requires an explicit migration and never creates tables automatically', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'scolo-public-schema-test-'))
  const client = createClient({ url: `file:${join(directory, 'test.db')}` })
  t.after(async () => { client.close(); await rm(directory, { recursive: true, force: true }) })
  await assert.rejects(createGameService(client, { walletMode: 'scolo' }), gameError('CONFIGURATION_ERROR'))
  assert.deepEqual((await client.execute("SELECT name FROM sqlite_master WHERE type = 'table'")).rows, [])
  await migrateLocalDatabase(client)
  const service = await createGameService(client, { walletMode: 'scolo', now: () => new Date(START) })
  const game = await service.getPublicGame()
  assert.equal(game.walletMode, 'scolo')
  assert.equal(game.isSimulated, false)
  assert.equal(game.round.pot, 0)
  assert.equal(game.history.length, 0)
  const sameService = await createGameService(client, { walletMode: 'scolo', now: () => new Date(START + HOUR) })
  assert.equal((await sameService.getPublicGame()).round.id, game.round.id)
})

test('only public settlements queue one tweet atomically; historical catches never post', async t => {
  const { service: localService, client, roundId, time } = await fixture(t)
  await localService.placePrediction({ userId: 'alice', roundId, predictedAt: new Date(START + DAY), stake: 1, idempotencyKey: 'tweet-game' })
  time(START + 2 * HOUR)
  const service = await createGameService(client, { walletMode: 'scolo', tweetEnabled: true, now: () => new Date(START + 2 * HOUR) })
  const input = { roundId, observedAt: new Date(START + HOUR), tool: 'sandale' }
  const result = await service.settleRound(input)
  assert.ok(result.appearanceId)
  assert.deepEqual(await service.settleRound(input), result)
  const tweets = (await client.execute('SELECT appearance_id,status FROM scolo_tweet_outbox')).rows
  assert.deepEqual(tweets.map(tweet => [Number(tweet.appearance_id), tweet.status]), [[result.appearanceId, 'pending']])
  await service.addHistoricalAppearance({ observedAt: new Date(START + HOUR + 20 * 60_000), tool: 'coutelas', actorUserId: 'admin', idempotencyKey: 'tweet-history' })
  assert.equal((await client.execute('SELECT COUNT(*) AS total FROM scolo_tweet_outbox')).rows[0]!.total, 1)
})

test('tweet queue errors roll back the settlement while local mode never queues', async t => {
  const { service: localService, client, roundId, time } = await fixture(t)
  await localService.placePrediction({ userId: 'alice', roundId, predictedAt: new Date(START + DAY), stake: 1, idempotencyKey: 'tweet-rollback' })
  time(START + 2 * HOUR)
  const service = await createGameService(client, { walletMode: 'scolo', tweetEnabled: true, now: () => new Date(START + 2 * HOUR) })
  await client.execute("CREATE TRIGGER fail_tweet BEFORE INSERT ON scolo_tweet_outbox BEGIN SELECT RAISE(ABORT, 'test failure'); END")
  const input = { roundId, observedAt: new Date(START + HOUR), tool: 'sandale' }
  await assert.rejects(service.settleRound(input))
  assert.equal((await service.getPublicGame()).round.id, roundId)
  assert.equal((await service.getPlayerGame('alice')).balance, 2)
  assert.equal((await client.execute('SELECT COUNT(*) AS total FROM "scolo-data"')).rows[0]!.total, 0)
  const local = await createGameService(client, { walletMode: 'local', tweetEnabled: true, now: () => new Date(START + 2 * HOUR) })
  await local.settleRound(input)
  assert.equal((await client.execute('SELECT COUNT(*) AS total FROM scolo_tweet_outbox')).rows[0]!.total, 0)
})
