import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { createClient } from '@libsql/client'
import { migrateGameDatabase } from '../src/server/db/local-migrations'
import { createGameService } from '../src/server/game/service'
import { buildAppearanceTweet } from '../src/server/social/tweet-outbox'
import { buildParticipationTweet, tweetLength, validTweet, SCOLO_URL } from '../src/server/social/tweet-text'
import { dispatchBufferParticipation, dispatchBufferAppearance, reconcileBufferPosts } from '../src/server/social/buffer-outbox'
import { nextParticipationTweet, enqueueParticipationTweet, PARTICIPATION_INTERVAL } from '../src/server/social/participation-tweets'
import type { BufferPost } from '../src/server/social/buffer'

const START = Date.parse('2030-01-01T12:00:00Z')
const DAY = 86400000
const config = { channelId: 'synthetic-channel' }
const queuedPost: BufferPost = { bufferPostId: 'participation-buffer-1', channelId: config.channelId, status: 'queued' }
const publisher = { publish: async () => queuedPost, getPost: async () => queuedPost }

async function fixture(t: TestContext, options: { environment?: 'prod' | 'dev' | 'local' } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'scolo-announcements-'))
  const url = `file:${join(directory, 'test.db')}`
  const client = createClient({ url })
  t.after(async () => { client.close(); await rm(directory, { recursive: true, force: true }) })
  await migrateGameDatabase(client)
  let clock = START
  const environment = options.environment ?? 'prod'
  const service = await createGameService(client, { walletMode: environment === 'prod' ? 'scolo' : 'local', environment, tweetEnabled: true, now: () => new Date(clock) })
  const roundId = (await service.getPublicGame()).round.id
  await client.execute({ sql: 'INSERT INTO "scolo-data" (created_at,tool) VALUES (?,?)', args: [(START - 12 * DAY) / 1000, 'sandale'] })
  let sequence = 0
  async function bet(user: number, round = roundId) {
    const userId = `synthetic-player-${user}`
    const player = await service.ensurePlayer({ userId, displayName: `Joueur ${user}` })
    if (player.created) {
      await client.execute({ sql: 'UPDATE scolo_wallets SET balance=100 WHERE player_id=?', args: [player.id] })
      await client.execute({ sql: "INSERT INTO scolo_wallet_entries (id,player_id,amount,kind,reference,created_at) VALUES (?,?,97,'fixture',?,?)", args: [`fund-${player.id}`, player.id, `fund-${player.id}`, clock] })
    }
    const input = { userId, roundId: round, predictedAt: new Date(clock + DAY), stake: 1, idempotencyKey: `announcement-${++sequence}` }
    await service.placePrediction(input)
    return input
  }
  const rows = async () => (await client.execute('SELECT * FROM scolo_participation_tweets ORDER BY created_at,id')).rows
  return { client, url, service, roundId, bet, rows, time: (now: number) => { clock = now } }
}

test('X counting handles URL weights, NFC and emoji instead of counting code points', () => {
  assert.equal(tweetLength(`a ${SCOLO_URL}`), 25)
  assert.equal(tweetLength('cafe\u0301'), 4)
  assert.equal(tweetLength('👨‍👩‍👧‍👦'), 2)
  assert.equal(validTweet('🙂'.repeat(141)), false)
  assert.equal(validTweet(' '), false)
  assert.equal(validTweet(`${'a'.repeat(256)} ${SCOLO_URL}`), true)
  assert.equal(validTweet(`${'a'.repeat(257)} ${SCOLO_URL}`), false)
})

test('approved participation copy fits with ordinary and maximum safe counts and preserves unknown run', () => {
  const text = buildParticipationTweet({ participants: 25, predictions: 42, pot: 84, since: START - 12 * DAY, now: START })
  assert.equal(text, `12 j sans croiser de scolo. Le run tient encore.\n\nOn est déjà à 25 joueurs et 42 pronostics, pour une cagnotte de 84 zikak.\n\nViens parier des zikak sur mon malheur ${SCOLO_URL}`)
  assert.equal(tweetLength(text), 187)
  const huge = buildParticipationTweet({ participants: Number.MAX_SAFE_INTEGER, predictions: Number.MAX_SAFE_INTEGER, pot: Number.MAX_SAFE_INTEGER, since: 0, now: START })
  assert.ok(validTweet(huge)); assert.ok(tweetLength(huge) <= 280)
  assert.match(buildParticipationTweet({ participants: 10, predictions: 10, pot: 10, since: null, now: START }), /Durée du run inconnue/)
})

test('appearance copy preserves run, winners, winnings, weapon and restart within 280 weighted characters', () => {
  const input = { observedAt: new Date(START), tool: 'coutelas', previousAppearanceAt: START - 12 * DAY, winners: [{ name: 'Alice', amount: 42 }, { name: 'Bob', amount: 42 }] }
  const text = buildAppearanceTweet(input)
  assert.match(text, /Run terminé après 12 j/)
  assert.match(text, /Alice et Bob se partagent 84 zikak/)
  assert.match(text, /Défense : coutelas/)
  assert.match(text, /Nouveau run, nouvelle manche/)
  assert.ok(validTweet(text))
  const huge = buildAppearanceTweet({ ...input, winners: Array.from({ length: 300 }, () => ({ name: '界'.repeat(60), amount: 1000 })) })
  assert.match(huge, /300 gagnants se partagent 300000 zikak/); assert.ok(validTweet(huge))
  const longNames = buildAppearanceTweet({ ...input, winners: [{ name: '界'.repeat(60), amount: Number.MAX_SAFE_INTEGER }] })
  assert.match(longNames, /1 gagnant remporte 9007199254740991 zikak/); assert.ok(validTweet(longNames))
  assert.match(buildAppearanceTweet({ ...input, winners: [], totalRefunded: 7 }), /Aucun gagnant. 7 zikak remboursés/)
  assert.match(buildAppearanceTweet({ ...input, winners: [], totalRefunded: 0 }), /Aucun gagnant sur cette manche/)
})

test('participant thresholds enqueue once and prediction replays do not change progress', async t => {
  const { service, bet, rows, client, roundId } = await fixture(t)
  for (let i = 0; i < 9; i++) await bet(i)
  assert.equal((await rows()).length, 0)
  const input = await bet(9)
  assert.equal((await rows()).length, 1)
  await service.placePrediction(input)
  await enqueueParticipationTweet(client, roundId, START, true)
  assert.equal((await rows()).length, 1)
  const row = (await rows())[0]!
  assert.match(String(row.content), /10 joueurs et 10 pronostics/)
  assert.equal(row.status, 'pending')
})

test('prediction milestones require five distinct players and combine with simultaneous participant milestones', async t => {
  const { bet, rows, client, roundId } = await fixture(t)
  for (let i = 0; i < 25; i++) await bet(i % 4)
  assert.equal((await rows()).length, 0, 'one small group cannot trigger a prediction-only announcement')
  await bet(4)
  assert.equal((await rows()).length, 1)
  for (let i = 5; i < 10; i++) await bet(i)
  assert.equal((await rows()).length, 1)
  assert.match(String((await rows())[0]!.content), /10 joueurs et 31 pronostics/)
  const progress = (await client.execute({ sql: 'SELECT * FROM scolo_participation_progress WHERE round_id=?', args: [roundId] })).rows[0]!
  assert.equal(progress.participant_milestone, 10); assert.equal(progress.prediction_milestone, 25)
})

test('delayed announcements refresh actual duration, pot and counts, merging all pending milestones', async t => {
  const { bet, rows, client } = await fixture(t)
  for (let i = 0; i < 25; i++) await bet(i)
  assert.equal((await rows()).length, 1)
  for (let i = 0; i < 17; i++) await bet(i)
  const id = await nextParticipationTweet(client, START + DAY)
  assert.equal(id, String((await rows())[0]!.id))
  const content = String((await rows())[0]!.content)
  assert.match(content, /^13 j sans croiser de scolo/)
  assert.match(content, /25 joueurs et 42 pronostics, pour une cagnotte de 42 zikak/)
})

test('atomic claims enforce the 24-hour limit across replicas and rounds', async t => {
  const { bet, rows, client, url, service, roundId, time } = await fixture(t)
  for (let i = 0; i < 25; i++) await bet(i)
  const firstId = String((await rows())[0]!.id)
  const second = createClient({ url }); t.after(() => second.close())
  let calls = 0
  const uncertain = { ...publisher, publish: async () => { calls++; return { ...queuedPost, bufferPostId: `post-${calls}`, status: 'sent' as const, tweetId: String(calls) } } }
  await Promise.all([client, second].map(connection => dispatchBufferParticipation(connection, firstId, { enabled: true, publisher: uncertain, config, now: () => START })))
  assert.equal(calls, 1)
  for (let i = 25; i < 50; i++) await bet(i)
  const pendingId = String((await rows()).find(row => row.status === 'pending')!.id)
  assert.equal(await nextParticipationTweet(client, START + DAY - 1), null)
  const refused = await dispatchBufferParticipation(client, pendingId, { enabled: true, publisher: uncertain, config, now: () => START + DAY - 1 })
  assert.equal(refused.status, 'pending'); assert.equal(calls, 1)
  time(START + 60000)
  const settled = await service.settleRound({ roundId, observedAt: new Date(START + 1000), tool: 'sandale' })
  for (let i = 50; i < 60; i++) await bet(i, settled.nextRoundId!)
  assert.equal(await nextParticipationTweet(client, START + DAY - 1), null)
  const eligible = await nextParticipationTweet(client, START + PARTICIPATION_INTERVAL)
  assert.ok(eligible)
  await dispatchBufferParticipation(client, eligible, { enabled: true, publisher: uncertain, config, now: () => START + DAY })
  assert.equal(calls, 2)
})

test('closed rounds discard pending participation while appearance announcements remain independent', async t => {
  const { bet, rows, client, service, roundId, time } = await fixture(t)
  for (let i = 0; i < 10; i++) await bet(i)
  const id = String((await rows())[0]!.id)
  time(START + 60000)
  const settlement = await service.settleRound({ roundId, observedAt: new Date(START + 1000), tool: 'sandale' })
  assert.equal((await rows())[0]!.status, 'skipped')
  assert.equal(await nextParticipationTweet(client, START + DAY), null)
  let calls = 0
  const api = { ...publisher, publish: async () => { calls++; return queuedPost } }
  assert.equal((await dispatchBufferParticipation(client, id, { enabled: true, publisher: api, config })).status, 'not-queued')
  assert.equal(calls, 0)
  assert.equal((await dispatchBufferAppearance(client, settlement.appearanceId!, { enabled: true, publisher: api, config })).status, 'queued')
  assert.equal(calls, 1)
})

test('participation receipts reconcile to an X id without another creation', async t => {
  const { bet, rows, client } = await fixture(t)
  for (let i = 0; i < 10; i++) await bet(i)
  const id = (await nextParticipationTweet(client, START))!
  const result = await dispatchBufferParticipation(client, id, { enabled: true, publisher, config, now: () => START })
  assert.equal(result.status, 'queued'); assert.equal(result.tweetId, undefined)
  await reconcileBufferPosts(client, { getPost: async () => ({ ...queuedPost, status: 'sent', tweetId: '987' }) }, config.channelId, START + 300000)
  assert.equal((await rows())[0]!.status, 'sent'); assert.equal((await rows())[0]!.tweet_id, '987')
})

test('participation enqueue rolls back with the bet; local and DEV never enqueue', async t => {
  const { bet, rows, client, service } = await fixture(t)
  for (let i = 0; i < 9; i++) await bet(i)
  await service.ensurePlayer({ userId: 'synthetic-player-9' })
  await client.execute("CREATE TRIGGER fail_participation BEFORE INSERT ON scolo_participation_tweets BEGIN SELECT RAISE(ABORT, 'synthetic queue failure'); END")
  await assert.rejects(bet(9), /synthetic queue failure/)
  assert.equal((await service.getPlayerGame('synthetic-player-9')).balance, 3)
  assert.equal((await service.getPublicGame()).round.predictionCount, 9)
  assert.equal((await rows()).length, 0)
  assert.equal((await client.execute('SELECT COUNT(*) AS n FROM scolo_participation_progress')).rows[0]!.n, 0)
  for (const environment of ['local', 'dev'] as const) {
    const local = await fixture(t, { environment })
    for (let i = 0; i < 10; i++) await local.bet(i)
    assert.equal((await local.rows()).length, 0)
  }
})

test('settlement counts distinct winners and excludes refunds and replay bonuses from the announced prize', async t => {
  const { client, service, roundId, time } = await fixture(t)
  await service.placePrediction({ userId: 'alice', displayName: 'Alice', roundId, predictedAt: new Date(START), stake: 1, idempotencyKey: 'alice-one' })
  await service.placePrediction({ userId: 'alice', roundId, predictedAt: new Date(START), stake: 1, idempotencyKey: 'alice-two' })
  await service.placePrediction({ userId: 'bob', displayName: 'Bob', roundId, predictedAt: new Date(START + 2 * DAY), stake: 3, idempotencyKey: 'bob-loses' })
  time(START + 3000)
  await service.placePrediction({ userId: 'late', roundId, predictedAt: new Date(START), stake: 2, idempotencyKey: 'late-refund' })
  time(START + 60000)
  const settled = await service.settleRound({ roundId, observedAt: new Date(START + 1000), tool: 'sandale' })
  assert.equal(settled.totalRefunded, 2); assert.equal(settled.totalReplayBonus, 2)
  const text = String((await client.execute('SELECT content FROM scolo_tweet_outbox')).rows[0]!.content)
  assert.match(text, /Alice remporte 5 zikak/)
  assert.doesNotMatch(text, /7 zikak|9 zikak|2 gagnants/)
  assert.match(text, /Run terminé après 12 j 1 s|Run terminé après 12 j/)
})

test('an uncertain or still queued publication blocks later milestones until reconciled, then waits 24h from sent', async t => {
  const { bet, rows, client } = await fixture(t)
  for (let i = 0; i < 10; i++) await bet(i)
  const first = String((await rows())[0]!.id)
  await dispatchBufferParticipation(client, first, { enabled: true, publisher, config, now: () => START })
  for (let i = 10; i < 25; i++) await bet(i)
  assert.equal(await nextParticipationTweet(client, START + DAY), null, 'a queued first post cannot overlap a new creation')
  await reconcileBufferPosts(client, { getPost: async () => ({ ...queuedPost, status: 'sent', tweetId: '123' }) }, config.channelId, START + DAY)
  assert.equal(await nextParticipationTweet(client, START + 2 * DAY - 1), null)
  const second = await nextParticipationTweet(client, START + 2 * DAY)
  assert.ok(second)
  await dispatchBufferParticipation(client, second, { enabled: true, config, now: () => START + 2 * DAY, publisher: { ...publisher, publish: async () => { throw new Error('lost response') } } })
  for (let i = 25; i < 50; i++) await bet(i)
  assert.equal(await nextParticipationTweet(client, START + 4 * DAY), null, 'unknown results need reconciliation before another participation tweet')
})

test('enabling participation on an existing round announces only newly crossed thresholds', async t => {
  const { client, bet, rows, roundId } = await fixture(t, { environment: 'dev' })
  for (let i = 0; i < 25; i++) await bet(i)
  const service = await createGameService(client, { walletMode: 'scolo', tweetEnabled: true, now: () => new Date(START) })
  for (let i = 25; i < 49; i++) await service.placePrediction({ userId: `new-player-${i}`, roundId, predictedAt: new Date(START + DAY), stake: 1, idempotencyKey: `new-bet-${i}` })
  assert.equal((await rows()).length, 0)
  await service.placePrediction({ userId: 'new-player-49', roundId, predictedAt: new Date(START + DAY), stake: 1, idempotencyKey: 'new-bet-49' })
  assert.equal((await rows()).length, 1)
  assert.match(String((await rows())[0]!.content), /50 joueurs et 50 pronostics/)
})

test('the participation cooldown starts after provider acceptance rather than before the HTTP call', async t => {
  const { bet, rows, client } = await fixture(t)
  for (let i = 0; i < 10; i++) await bet(i)
  let clock = START
  const api = { ...publisher, publish: async () => { clock += 10000; return { ...queuedPost, status: 'sent' as const, tweetId: '123' } } }
  await dispatchBufferParticipation(client, String((await rows())[0]!.id), { enabled: true, publisher: api, config, now: () => clock })
  assert.equal((await rows())[0]!.published_at, START + 10000)
  for (let i = 10; i < 25; i++) await bet(i)
  assert.equal(await nextParticipationTweet(client, START + DAY), null)
  assert.ok(await nextParticipationTweet(client, START + DAY + 10000))
})
