import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createHash } from 'node:crypto'
import { advanceRun, createRun } from '../src/game/sandale/engine'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NextApiRequest } from 'next'
import { TRPCError } from '@trpc/server'

const directory = await mkdtemp(join(tmpdir(), 'scolo-arcade-api-'))
Object.assign(process.env, {
  SCOLO_WALLET_MODE: 'local', SCOLO_ENVIRONMENT: 'local', DATABASE_URL: `file:${join(directory, 'test.db')}`,
  APP_URL: 'http://localhost:3092', SCOLO_ADMIN_USER_IDS: '', CLERK_SECRET_KEY: 'sk_test_disposable_api_test',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from('example.clerk.accounts.dev$').toString('base64')}`,
  SCOLO_TWEETS_ENABLED: 'false', SCOLO_ZIKAK_SYNC_ENABLED: 'false',
})
const { arcadeRouter } = await import('../src/server/api/routers/arcade')
const { getDatabaseClient } = await import('../src/server/db')
const { env } = await import('../src/env.js')
const request = (origin = 'http://localhost:3092') => ({ headers: { host: 'localhost:3092', origin, 'sec-fetch-site': 'same-origin' }, cookies: {} }) as unknown as NextApiRequest
const code = (expected: string) => (error: unknown) => error instanceof TRPCError && error.code === expected
after(async () => { getDatabaseClient(env).close(); await rm(directory, { recursive: true, force: true }) })

test('arcade refuses anonymous claims, foreign writes and another viewer identity', async () => {
  const visitor = arcadeRouter.createCaller({ req: request(), userId: null, isAdmin: false })
  await assert.rejects(visitor.claim({ viewerId: 'invented-user' }), code('UNAUTHORIZED'))
  await assert.rejects(visitor.reward({ viewerId: 'invented-user' }), code('UNAUTHORIZED'))
  await assert.rejects(visitor.leaderboard({ viewerId: 'invented-user' }), code('UNAUTHORIZED'))
  await assert.rejects(visitor.standings({ viewerId: 'invented-user' }), code('UNAUTHORIZED'))
  await assert.rejects(visitor.standings({ viewerId: null, offset: -1 }), code('BAD_REQUEST'))
  const foreign = arcadeRouter.createCaller({ req: request('https://foreign.example'), userId: null, isAdmin: false })
  await assert.rejects(foreign.start(), code('FORBIDDEN'))
  await assert.rejects(foreign.restore({ token: 'a'.repeat(64) }), code('FORBIDDEN'))
  await assert.rejects(foreign.reward({ viewerId: 'invented-user' }), code('FORBIDDEN'))
  const connected = arcadeRouter.createCaller({ req: request(), userId: 'actual-user', isAdmin: false })
  await assert.rejects(connected.claim({ viewerId: 'other-user' }), code('UNAUTHORIZED'))
  await assert.rejects(connected.pending({ viewerId: null }), code('UNAUTHORIZED'))
  assert.deepEqual(await visitor.leaderboard({ viewerId: null }), { entries: [], me: null, reward: null })
  assert.equal(await visitor.pending({ viewerId: null }), null)
  const session = await visitor.start()
  assert.match(session.token, /^[a-f0-9]{64}$/)
  assert.equal(session.rules, 'sandale-v3')
})

test('records are read-only and ignore the latest result cookie', async () => {
  const req = request()
  const visitor = arcadeRouter.createCaller({ req, userId: null, isAdmin: false })
  const session = await visitor.start()
  const run = createRun(session.seed)
  while (run.status === 'running') advanceRun(run, 20)
  const client = getDatabaseClient(env)
  await client.execute({ sql: 'UPDATE scolo_arcade_runs SET started_at=? WHERE token_hash=?', args: [Date.now() - run.elapsedMs - 1000, createHash('sha256').update(session.token).digest('hex')] })
  const result = await visitor.finish({ token: session.token, elapsedMs: run.elapsedMs, actions: [] })
  req.cookies.scolo_arcade_latest = session.token
  const before = (await client.execute('SELECT * FROM scolo_arcade_runs ORDER BY id')).rows
  const records = await visitor.standings({ viewerId: null, view: 'records' })
  assert.equal(records.me, null)
  assert.equal(records.sessionId, null)
  assert.equal(records.offset, 0)
  assert.equal(records.total, 0)
  assert.deepEqual(records.entries, [])
  const latest = await visitor.standings({ viewerId: null })
  assert.equal(latest.sessionId, result.id)
  assert.equal(latest.me?.isCurrentRun, true)
  assert.equal(latest.total, 1)
  assert.deepEqual((await client.execute('SELECT * FROM scolo_arcade_runs ORDER BY id')).rows, before)
  await assert.rejects(visitor.standings({ viewerId: 'another-viewer', view: 'records' }), code('UNAUTHORIZED'))
})
