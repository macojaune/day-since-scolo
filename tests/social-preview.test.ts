import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { createGameService } from '../src/server/game/service'
import { readSocialCardData, socialImageAlt, socialMetadata, unavailableSocialCardData } from '../src/server/social/preview-data'
import { renderSocialImage } from '../src/server/social/preview-image'

test('social preview counts active tickets in the current round, not players or settled tickets, and never mutates the game', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'scolo-og-test-'))
  const client = createClient({ url: `file:${join(directory, 'test.db')}` })
  t.after(async () => { client.close(); await rm(directory, { recursive: true, force: true }) })
  let now = new Date('2030-01-01T12:00:00Z')
  const service = await createGameService(client, { now: () => now })
  const roundId = (await service.getPublicGame()).round.id
  for (const [index, userId] of ['alice', 'alice', 'alice', 'bob'].entries()) {
    await service.placePrediction({ userId, roundId, predictedAt: now, stake: 1, idempotencyKey: `social-test-${index}` })
  }
  const before = await service.getPublicGame()
  const balances = await Promise.all(['alice', 'bob'].map(id => service.getPlayerGame(id)))
  assert.equal(before.round.participantCount, 2)
  const snapshot = await readSocialCardData(client, 'local', now)
  assert.equal(snapshot.predictionCount, 4)
  assert.deepEqual(await service.getPublicGame(), before)
  assert.deepEqual(await Promise.all(['alice', 'bob'].map(id => service.getPlayerGame(id))), balances)
  assert.doesNotMatch(JSON.stringify(snapshot), /alice|bob|userId|player|roundId|email|displayName/)

  now = new Date('2030-01-01T13:00:00Z')
  await service.settleRound({ roundId, observedAt: now, tool: 'coutelas' })
  const next = await readSocialCardData(client, 'local', new Date('2030-01-02T12:59:59Z'))
  assert.equal(next.predictionCount, 0)
  assert.equal(next.weapon, 'coutelas')
  assert.equal(next.daysWithoutAppearance, 0)
  const dayLater = await readSocialCardData(client, 'local', new Date('2030-01-02T13:00:00Z'))
  assert.equal(dayLater.daysWithoutAppearance, 1)
})

test('reading social data before game initialization never creates tables or rounds', async t => {
  const client = createClient({ url: ':memory:' })
  t.after(() => client.close())
  await assert.rejects(readSocialCardData(client, 'local'))
  const tables = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
  assert.deepEqual(tables.rows, [])
})

test('social metadata uses the configured origin and changes its image version when public data changes', () => {
  const data = { predictionCount: 1, daysWithoutAppearance: 0, weapon: 'sandale' as const, weaponLabel: 'Sandale' }
  const metadata = socialMetadata(data, 'https://scolo.marvinl.com')
  assert.match(metadata.imageAlt, /1 pari validé pour la manche en cours/)
  assert.match(metadata.imageUrl, /^https:\/\/scolo\.marvinl\.com\/api\/og\?v=[a-f0-9]{16}$/)
  for (const change of [{ predictionCount: 2 }, { daysWithoutAppearance: 1 }, { weapon: 'coutelas' as const, weaponLabel: 'Coutelas' }]) {
    assert.notEqual(socialMetadata({ ...data, ...change }, metadata.pageUrl).imageUrl, metadata.imageUrl)
  }
  assert.equal(socialMetadata(data, 'http://localhost:3092').pageUrl, 'http://localhost:3092/')
  const unavailable = unavailableSocialCardData()
  assert.equal(unavailable.predictionCount, null)
  assert.doesNotMatch(socialImageAlt(unavailable), /0 pari/)
})

test('Vercel OG renders valid 1200x630 PNGs for available and unavailable data', async () => {
  for (const data of [
    { predictionCount: 0, daysWithoutAppearance: 0, weapon: 'sandale' as const, weaponLabel: 'Sandale' },
    { predictionCount: 1, daysWithoutAppearance: 19, weapon: 'coutelas' as const, weaponLabel: 'Coutelas' },
    { predictionCount: 9999999, daysWithoutAppearance: 900, weapon: 'digrain' as const, weaponLabel: 'Digrain' },
    { predictionCount: 26, daysWithoutAppearance: 7, weapon: 'capes' as const, weaponLabel: 'CAPES' },
    unavailableSocialCardData(),
  ]) {
    const image = await renderSocialImage(data)
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.equal(image.readUInt32BE(16), 1200)
    assert.equal(image.readUInt32BE(20), 630)
  }
})
