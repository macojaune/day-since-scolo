import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { createClient } from '@libsql/client'
import { buildAppearanceTweet, dispatchAppearanceTweet, enqueueAppearanceTweet, tweetOutboxSchema } from '../src/server/social/tweet-outbox'
import { createTwitterPublisher, TweetPublicationError, twitterAuthorization } from '../src/server/social/twitter'

const credentials = { appKey: 'consumer', appSecret: 'consumer-secret', accessToken: 'user-token', accessSecret: 'user-secret' }
const appearedAt = new Date('2026-10-28T03:10:00.000Z')

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'scolo-twitter-test-'))
  const url = `file:${join(directory, 'test.db')}`
  const client = createClient({ url })
  t.after(async () => { client.close(); await rm(directory, { recursive: true, force: true }) })
  await client.execute('PRAGMA foreign_keys = ON')
  await client.execute('CREATE TABLE "scolo-data" (id INTEGER PRIMARY KEY,created_at INTEGER,tool TEXT)')
  await client.execute("INSERT INTO \"scolo-data\" VALUES (1,1793157000,'sandale')")
  await client.execute(tweetOutboxSchema)
  const input = { appearanceId: 1, observedAt: appearedAt, tool: 'sandale', createdAt: appearedAt.getTime() + 60_000 }
  const queued = async () => enqueueAppearanceTweet(client, input, true)
  return { client, input, queued, url }
}

test('OAuth 1.0a matches the published RFC 5849 GET example', () => {
  const result = twitterAuthorization('GET', 'http://photos.example.net/photos?file=vacation.jpg&size=original', {
    appKey: 'dpf43f3p2l4k3l03', appSecret: 'kd94hf93k423kf44', accessToken: 'nnch734d00sl2jdk', accessSecret: 'pfkkdhi9sl3r4s00',
  }, { nonce: 'kllo9940pd9333jh', timestamp: 1191242096 })
  assert.ok(result.includes('oauth_signature="tR3%2BTy81lMeYAr%2FFid0kMTYa%2FWM%3D"'))
  assert.ok(!result.includes('kd94hf93k423kf44'))
})

test('appearance text uses the real Guadeloupe date and unknown tools stay unknown', () => {
  const text = buildAppearanceTweet({ observedAt: appearedAt, tool: 'sandale' })
  assert.ok(text.includes('27/10/2026 à 23:10'))
  assert.ok(text.includes('sandale'))
  assert.ok(text.endsWith('https://scolo.marvinl.com'))
  assert.ok(Array.from(text).length < 280)
  assert.ok(buildAppearanceTweet({ observedAt: appearedAt, tool: '' }).includes('non renseigné'))
})

test('publication is disabled by default without database or network access', async () => {
  const client = { execute: async () => { throw new Error('Must not access DB') } }
  await enqueueAppearanceTweet(client, { appearanceId: 1, observedAt: appearedAt, tool: 'sandale', createdAt: 1 })
  const result = await dispatchAppearanceTweet(client, 1, { publish: async () => { throw new Error('Must not publish') } })
  assert.equal(result.status, 'disabled')
})

test('queue is unique by appearance and rolls back with the appearance transaction', async t => {
  const { client, input, queued } = await fixture(t)
  const transaction = await client.transaction('write')
  await enqueueAppearanceTweet(transaction, input, true)
  await transaction.rollback(); transaction.close()
  assert.equal((await client.execute('SELECT COUNT(*) AS count FROM scolo_tweet_outbox')).rows[0]!.count, 0)
  await queued(); await queued()
  assert.equal((await client.execute('SELECT COUNT(*) AS count FROM scolo_tweet_outbox')).rows[0]!.count, 1)
  await assert.rejects(enqueueAppearanceTweet(client, { ...input, tool: 'coutelas' }, true), /conflict/)
})

test('two database connections can dispatch an appearance only once', async t => {
  const { client, queued, url } = await fixture(t)
  const second = createClient({ url }); t.after(() => second.close())
  await queued()
  let calls = 0
  const publish = async () => { calls++; return { id: '123456' } }
  const results = await Promise.all([client, second].map(connection => dispatchAppearanceTweet(connection, 1, { enabled: true, publish })))
  assert.equal(calls, 1)
  assert.ok(results.some(result => result.status === 'sent'))
  const retry = await dispatchAppearanceTweet(second, 1, { enabled: true, publish })
  assert.equal(retry.status, 'sent'); assert.equal(retry.tweetId, '123456'); assert.equal(calls, 1)
})

test('a known rejection records a safe failure and never replays automatically', async t => {
  const { client, queued } = await fixture(t)
  await queued()
  let calls = 0
  const publish = async () => { calls++; throw new TweetPublicationError('failed', 'TWITTER_HTTP_401') }
  const first = await dispatchAppearanceTweet(client, 1, { enabled: true, publish })
  const retry = await dispatchAppearanceTweet(client, 1, { enabled: true, publish })
  assert.equal(first.status, 'failed'); assert.equal(retry.status, 'failed'); assert.equal(calls, 1)
  assert.equal(retry.errorCode, 'TWITTER_HTTP_401')
})

test('an ambiguous timeout remains unknown and is never reposted', async t => {
  const { client, queued } = await fixture(t)
  await queued()
  let calls = 0
  const publish = async () => { calls++; throw new Error('lost response containing secret credentials') }
  const result = await dispatchAppearanceTweet(client, 1, { enabled: true, publish })
  assert.equal(result.status, 'unknown'); assert.equal(result.errorCode, 'TWITTER_OUTCOME_UNKNOWN')
  await dispatchAppearanceTweet(client, 1, { enabled: true, publish })
  assert.equal(calls, 1)
  assert.ok(!JSON.stringify((await client.execute('SELECT * FROM scolo_tweet_outbox')).rows).includes('secret credentials'))
})

test('a crash persisting a successful response leaves a non-replayable sending row', async t => {
  const { client, queued } = await fixture(t)
  await queued()
  let calls = 0
  const publish = async () => { calls++; return { id: '123' } }
  const failingConnection = { execute: (statement: Parameters<typeof client.execute>[0]) => {
    if (typeof statement !== 'string' && statement.sql.includes("status = 'sent'")) throw new Error('DB unavailable after X accepted')
    return client.execute(statement)
  } }
  await assert.rejects(dispatchAppearanceTweet(failingConnection, 1, { enabled: true, publish }), /DB unavailable/)
  const retry = await dispatchAppearanceTweet(client, 1, { enabled: true, publish })
  assert.equal(retry.status, 'sending'); assert.equal(calls, 1)
})

test('publisher sends one authenticated JSON request and extracts the post id', async () => {
  const calls: { target: string; init: RequestInit | undefined }[] = []
  const request: typeof fetch = async (target, init) => {
    calls.push({ target: String(target), init })
    return new Response(JSON.stringify({ data: { id: '123', text: 'hello' } }), { status: 201 })
  }
  assert.deepEqual(await createTwitterPublisher(credentials, { fetch: request })('hello'), { id: '123' })
  assert.equal(calls.length, 1); assert.equal(calls[0]!.target, 'https://api.x.com/2/tweets')
  assert.equal(calls[0]!.init!.body, JSON.stringify({ text: 'hello' }))
  assert.match(new Headers(calls[0]!.init!.headers).get('Authorization')!, /^OAuth /)
  assert.equal(calls[0]!.init!.redirect, 'error')
})

test('publisher classifies HTTP rejection separately from ambiguous server/network responses', async () => {
  for (const [status, expected] of [[401, 'failed'], [403, 'failed'], [429, 'failed'], [503, 'unknown']] as const) {
    let calls = 0
    const publish = createTwitterPublisher(credentials, { fetch: async () => { calls++; return new Response('private raw payload', { status }) } })
    await assert.rejects(publish('hello'), error => error instanceof TweetPublicationError && error.outcome === expected && error.code === `TWITTER_HTTP_${status}`)
    assert.equal(calls, 1)
  }
  const timeout = createTwitterPublisher(credentials, { fetch: async () => { throw new Error('secret failure') } })
  await assert.rejects(timeout('hello'), error => error instanceof TweetPublicationError && error.outcome === 'unknown' && error.code === 'TWITTER_NETWORK_OUTCOME_UNKNOWN')
  const malformed = createTwitterPublisher(credentials, { fetch: async () => new Response('{}', { status: 201 }) })
  await assert.rejects(malformed('hello'), error => error instanceof TweetPublicationError && error.outcome === 'unknown')
})

test('missing credentials fail before sending any request', async () => {
  const publish = createTwitterPublisher({ ...credentials, accessToken: '' }, { fetch: async () => { throw new Error('Must not request') } })
  await assert.rejects(publish('hello'), error => error instanceof TweetPublicationError && error.code === 'TWITTER_CONFIGURATION')
})
