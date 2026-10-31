import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { createClient } from '@libsql/client'
import { createBufferPublisher, type BufferPost } from '../src/server/social/buffer'
import { dispatchBufferAppearance, reconcileBufferPosts } from '../src/server/social/buffer-outbox'
import { buildAppearanceTweet, enqueueAppearanceTweet } from '../src/server/social/tweet-outbox'
import { TweetPublicationError } from '../src/server/social/publication-error'
import { migrateGameDatabase } from '../src/server/db/local-migrations'
import { createGameService } from '../src/server/game/service'

const config = { apiKey: 'synthetic-buffer-key', channelId: 'channel-scolo-test' }
const appearedAt = new Date('2026-10-28T03:10:00.000Z')
const queuedPost: BufferPost = { bufferPostId: 'buffer-123', channelId: config.channelId, status: 'queued' }
const channel = { id: config.channelId, service: 'twitter', isDisconnected: false, isLocked: false, isQueuePaused: false }
type WirePost = { id: string; channelId: string; status: string; externalLink: string | null }
const wirePost: WirePost = { id: 'buffer-123', channelId: config.channelId, status: 'scheduled', externalLink: null }
const response = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 })
const publisher = (publish: (text: string) => Promise<BufferPost>, getPost = async () => queuedPost) => ({ publish, getPost })

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'scolo-buffer-test-'))
  const url = `file:${join(directory, 'test.db')}`
  const client = createClient({ url })
  t.after(async () => { client.close(); await rm(directory, { recursive: true, force: true }) })
  await migrateGameDatabase(client)
  await client.execute("INSERT INTO \"scolo-data\" VALUES (1,1793157000,'sandale')")
  const input = { appearanceId: 1, observedAt: appearedAt, tool: 'sandale', createdAt: appearedAt.getTime() + 60_000 }
  return { client, input, url, queued: () => enqueueAppearanceTweet(client, input, true) }
}

function fakeBuffer(post = wirePost): typeof fetch {
  return async (_target, init) => {
    const body = JSON.parse(String(init?.body)) as { query: string }
    return response(body.query.includes('ScoloChannel') ? { channel } : body.query.includes('mutation')
      ? { createPost: { __typename: 'PostActionSuccess', post } } : { post })
  }
}

test('appearance text uses Guadeloupe dates and unknown tools remain unknown', () => {
  const text = buildAppearanceTweet({ observedAt: appearedAt, tool: 'sandale' })
  assert.ok(text.includes('27/10/2026 à 23:10'))
  assert.ok(text.endsWith('https://scolo.marvinl.com'))
  assert.ok(Array.from(text).length < 280)
  assert.ok(buildAppearanceTweet({ observedAt: appearedAt, tool: '' }).includes('non renseigné'))
})

test('disabled publication makes no database or network calls', async () => {
  const client = { execute: async () => { throw new Error('Must not access DB') } }
  await enqueueAppearanceTweet(client, { appearanceId: 1, observedAt: appearedAt, tool: 'sandale', createdAt: 1 })
  const result = await dispatchBufferAppearance(client, 1, { config, publisher: publisher(async () => { throw new Error('Must not publish') }) })
  assert.equal(result.status, 'disabled')
})

test('queue is unique by appearance and rolls back with its transaction', async t => {
  const { client, input, queued } = await fixture(t)
  const transaction = await client.transaction('write')
  await enqueueAppearanceTweet(transaction, input, true)
  await transaction.rollback(); transaction.close()
  assert.equal((await client.execute('SELECT COUNT(*) AS n FROM scolo_tweet_outbox')).rows[0]!.n, 0)
  await queued(); await queued()
  assert.equal((await client.execute('SELECT COUNT(*) AS n FROM scolo_tweet_outbox')).rows[0]!.n, 1)
  await assert.rejects(enqueueAppearanceTweet(client, { ...input, tool: 'coutelas' }, true), /conflict/)
})

test('Buffer checks the X destination and requests immediate publication with a link', async () => {
  const calls: { target: string; init: RequestInit | undefined }[] = []
  const request: typeof fetch = async (target, init) => { calls.push({ target: String(target), init }); return fakeBuffer()(target, init) }
  const text = 'Nouvelle apparition ! https://scolo.marvinl.com'
  assert.deepEqual(await createBufferPublisher(config, { fetch: request }).publish(text), queuedPost)
  assert.equal(calls.length, 2)
  for (const call of calls) {
    assert.equal(call.target, 'https://api.buffer.com')
    assert.equal(new Headers(call.init?.headers).get('Authorization'), 'Bearer synthetic-buffer-key')
    assert.equal(call.init?.redirect, 'error')
  }
  const body = JSON.parse(String(calls[1]!.init?.body)) as { variables: { input: unknown } }
  assert.deepEqual(body.variables.input, { text, channelId: config.channelId, schedulingType: 'automatic', mode: 'shareNow', assets: [], needsApproval: false, saveToDraft: false })
})

test('wrong, disconnected, paused or locked channels are rejected before post creation', async () => {
  for (const invalid of [{ ...channel, service: 'linkedin' }, { ...channel, id: 'other' }, { ...channel, isDisconnected: true }, { ...channel, isLocked: true }, { ...channel, isQueuePaused: true }]) {
    let calls = 0
    const api = createBufferPublisher(config, { fetch: async () => { calls++; return response({ channel: invalid }) } })
    await assert.rejects(api.publish('hello'), error => error instanceof TweetPublicationError && error.outcome === 'failed')
    assert.equal(calls, 1)
  }
})

test('an accepted post stays queued and concurrent/repeated dispatch never creates it twice', async t => {
  const { client, queued, url } = await fixture(t)
  const second = createClient({ url }); t.after(() => second.close())
  await queued()
  let calls = 0
  const api = publisher(async () => { calls++; return queuedPost })
  await Promise.all([client, second].map(connection => dispatchBufferAppearance(connection, 1, { enabled: true, publisher: api, config, now: () => 1000 })))
  const result = await dispatchBufferAppearance(second, 1, { enabled: true, publisher: api, config })
  assert.equal(result.status, 'queued'); assert.equal(result.bufferPostId, 'buffer-123'); assert.equal(result.tweetId, undefined)
  assert.equal(calls, 1)
  const row = (await client.execute('SELECT status, tweet_id, published_at FROM scolo_tweet_outbox')).rows[0]!
  assert.equal(row.status, 'sending'); assert.equal(row.tweet_id, null); assert.equal(row.published_at, null)
})

test('reconciliation records the real X id only after sent and never creates another post', async t => {
  const { client, queued } = await fixture(t); await queued()
  const api = publisher(async () => queuedPost)
  await dispatchBufferAppearance(client, 1, { enabled: true, publisher: api, config, now: () => 0 })
  let reads = 0
  const lookup = { getPost: async () => { reads++; return { ...queuedPost, status: 'sent' as const, tweetId: '987654321' } } }
  assert.equal(await reconcileBufferPosts(client, lookup, config.channelId, 299_999), 0)
  await reconcileBufferPosts(client, lookup, 'different-channel', 300_000)
  assert.equal(reads, 0)
  await Promise.all([1, 2].map(() => reconcileBufferPosts(client, lookup, config.channelId, 300_000)))
  assert.equal(reads, 1)
  const result = await dispatchBufferAppearance(client, 1, { enabled: true, publisher: api, config })
  assert.equal(result.status, 'sent'); assert.equal(result.tweetId, '987654321')
  assert.equal((await client.execute('SELECT published_at FROM scolo_tweet_outbox')).rows[0]!.published_at, 300_000)
})

test('lookup failures keep the accepted reference and stop after twelve checks', async t => {
  const { client, queued } = await fixture(t); await queued()
  await dispatchBufferAppearance(client, 1, { enabled: true, publisher: publisher(async () => queuedPost), config, now: () => 0 })
  let reads = 0
  const lookup = { getPost: async () => { reads++; throw new Error('private provider response') } }
  for (let i = 1; i <= 14; i++) await reconcileBufferPosts(client, lookup, config.channelId, i * 300_000)
  assert.equal(reads, 12)
  const row = (await client.execute('SELECT status, error_code FROM scolo_tweet_outbox')).rows[0]!
  assert.equal(row.status, 'sending'); assert.equal(row.error_code, 'BUFFER_STATUS_UNAVAILABLE')
  assert.ok(!JSON.stringify(row).includes('private'))
})

test('Buffer publishing errors become failed without replaying the creation', async t => {
  const { client, queued } = await fixture(t); await queued()
  const api = publisher(async () => queuedPost)
  await dispatchBufferAppearance(client, 1, { enabled: true, publisher: api, config, now: () => 0 })
  await reconcileBufferPosts(client, { getPost: async () => ({ ...queuedPost, status: 'failed' }) }, config.channelId, 300_000)
  assert.equal((await dispatchBufferAppearance(client, 1, { enabled: true, publisher: api, config })).status, 'failed')
})

test('rejected and ambiguous creations never replay or persist raw provider errors', async t => {
  for (const failure of [new TweetPublicationError('failed', 'BUFFER_POST_REJECTED'), new Error('private secret response')]) {
    const { client, queued } = await fixture(t); await queued()
    let calls = 0
    const api = publisher(async () => { calls++; throw failure })
    const first = await dispatchBufferAppearance(client, 1, { enabled: true, publisher: api, config })
    const second = await dispatchBufferAppearance(client, 1, { enabled: true, publisher: api, config })
    assert.equal(first.status, failure instanceof TweetPublicationError ? 'failed' : 'unknown')
    assert.equal(first.status, second.status); assert.equal(calls, 1)
    assert.ok(!JSON.stringify((await client.execute('SELECT * FROM scolo_tweet_outbox')).rows).includes('private secret'))
  }
})

test('database failure after Buffer acceptance leaves sending and prevents reposting', async t => {
  const { client, queued } = await fixture(t); await queued()
  let calls = 0
  const api = publisher(async () => { calls++; return queuedPost })
  const failing = { execute: (statement: Parameters<typeof client.execute>[0]) => {
    if (typeof statement !== 'string' && statement.sql.startsWith('INSERT INTO scolo_buffer_posts')) throw new Error('DB unavailable after acceptance')
    return client.execute(statement)
  } }
  await assert.rejects(dispatchBufferAppearance(failing, 1, { enabled: true, publisher: api, config }), /DB unavailable/)
  assert.equal((await dispatchBufferAppearance(client, 1, { enabled: true, publisher: api, config })).status, 'sending')
  assert.equal(calls, 1)
})

test('HTTP and GraphQL rejections are distinguished from lost mutation responses', async () => {
  for (const [status, expected] of [[401, 'failed'], [429, 'failed'], [503, 'unknown']] as const) {
    let calls = 0
    const api = createBufferPublisher(config, { fetch: async () => ++calls === 1 ? response({ channel }) : new Response('private', { status }) })
    await assert.rejects(api.publish('hello'), error => error instanceof TweetPublicationError && error.outcome === expected && error.code === `BUFFER_HTTP_${status}`)
    assert.equal(calls, 2)
  }
  for (const payload of [{ errors: [{ message: 'private' }] }, {}, { data: { createPost: { __typename: 'LimitReachedError', message: 'private' } } }]) {
    let calls = 0
    const api = createBufferPublisher(config, { fetch: async () => ++calls === 1 ? response({ channel }) : new Response(JSON.stringify(payload)) })
    await assert.rejects(api.publish('hello'), error => error instanceof TweetPublicationError && !error.message.includes('private'))
  }
  let calls = 0
  const api = createBufferPublisher(config, { fetch: async () => { if (++calls === 1) return response({ channel }); throw new Error('lost mutation response') } })
  await assert.rejects(api.publish('hello'), error => error instanceof TweetPublicationError && error.outcome === 'unknown')
  assert.equal(calls, 2)
})

test('sent receipts require a real X reference, preserving the Buffer id if it is delayed', async () => {
  const api = createBufferPublisher(config, { fetch: fakeBuffer({ ...wirePost, status: 'sent', externalLink: 'https://x.com/scolo/status/987654321' }) })
  assert.deepEqual(await api.getPost('buffer-123'), { ...queuedPost, status: 'sent', tweetId: '987654321' })
  for (const externalLink of [null, 'https://x.com.evil.example/scolo/status/123', 'https://user:pass@x.com/scolo/status/123']) {
    const delayed = createBufferPublisher(config, { fetch: fakeBuffer({ ...wirePost, status: 'sent', externalLink }) })
    assert.deepEqual(await delayed.getPost('buffer-123'), queuedPost)
  }
  await assert.rejects(api.getPost('wrong-id'), /BUFFER_INVALID_RESPONSE/)
})

test('invalid configuration and invalid content make no network requests', async () => {
  const request: typeof fetch = async () => { throw new Error('Must not request') }
  for (const invalid of [{ ...config, apiKey: '' }, { ...config, channelId: '' }, { ...config, apiKey: 'contains space' }]) {
    await assert.rejects(createBufferPublisher(invalid, { fetch: request }).publish('hello'), /BUFFER_CONFIGURATION/)
  }
  for (const text of ['', ' ', 'x'.repeat(281)]) await assert.rejects(createBufferPublisher(config, { fetch: request }).publish(text), /BUFFER_INVALID_TEXT/)
})

test('settlement through SQLite and real HTTP reaches sent once, with a link and preserved game balances', async t => {
  const { client } = await fixture(t)
  let clock = appearedAt.getTime()
  const service = await createGameService(client, { walletMode: 'scolo', tweetEnabled: true, now: () => new Date(clock) })
  const roundId = (await service.getPublicGame()).round.id
  await service.placePrediction({ userId: 'synthetic-player', displayName: 'pirate_maggma', roundId, predictedAt: new Date(clock + 60_000), stake: 1, idempotencyKey: 'test-buffer-bet' })
  clock += 120_000
  const input = { roundId, observedAt: new Date(clock - 1000), tool: 'sandale' }
  const settlement = await service.settleRound(input)
  const before = await service.getPlayerGame('synthetic-player')
  const content = String((await client.execute('SELECT content FROM scolo_tweet_outbox')).rows[0]!.content)
  assert.match(content, /\n\n@pirate_maggma remporte 1 zikak\.\n\nNouvelle manche ouverte\.\nViens parier/)
  let creations = 0, reads = 0
  const server: Server = createServer((request, result) => {
    void (async () => {
      assert.equal(request.method, 'POST')
      assert.equal(request.headers.authorization, 'Bearer synthetic-buffer-key')
      let raw = ''; for await (const chunk of request) raw += String(chunk)
      const body = JSON.parse(raw) as { query: string; variables: { input: { text: string } } }
      let data: unknown
      if (body.query.includes('ScoloChannel')) data = { channel }
      else if (body.query.includes('mutation')) {
        creations++; assert.equal(body.variables.input.text, content)
        data = { createPost: { __typename: 'PostActionSuccess', post: wirePost } }
      } else { reads++; data = { post: { ...wirePost, status: 'sent', externalLink: 'https://x.com/scolo/status/987654321' } } }
      result.writeHead(200, { 'Content-Type': 'application/json' }); result.end(JSON.stringify({ data }))
    })().catch(error => { result.writeHead(500); result.end(String(error)) })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const request: typeof fetch = async (target, init) => { assert.equal(target, 'https://api.buffer.com'); return fetch(`http://127.0.0.1:${address.port}`, init) }
  const api = createBufferPublisher(config, { fetch: request })
  assert.equal((await dispatchBufferAppearance(client, settlement.appearanceId!, { enabled: true, publisher: api, config, now: () => clock })).status, 'queued')
  await service.settleRound(input)
  await dispatchBufferAppearance(client, settlement.appearanceId!, { enabled: true, publisher: api, config })
  await reconcileBufferPosts(client, api, config.channelId, clock + 300_000)
  assert.equal((await dispatchBufferAppearance(client, settlement.appearanceId!, { enabled: true, publisher: api, config })).status, 'sent')
  assert.equal(creations, 1); assert.equal(reads, 1)
  assert.deepEqual(await service.getPlayerGame('synthetic-player'), before)
})
