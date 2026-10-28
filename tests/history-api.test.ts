import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { NextApiRequest } from 'next'
import { TRPCError } from '@trpc/server'

// Each node:test file has its own process. API tests use only this disposable DB.
const directory = await mkdtemp(join(tmpdir(), 'scolo-history-api-'))
Object.assign(process.env, {
  SCOLO_WALLET_MODE: 'local', DATABASE_URL: `file:${join(directory, 'test.db')}`,
  APP_URL: 'http://localhost:3092', SCOLO_ADMIN_USER_IDS: 'admin',
  CLERK_SECRET_KEY: 'sk_test_disposable_api_test',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from('example.clerk.accounts.dev$').toString('base64')}`,
  SCOLO_TWEETS_ENABLED: 'false',
})
const { appRouter } = await import('../src/server/api/routers/app')
const { getDatabaseClient } = await import('../src/server/db')
const { env } = await import('../src/env.js')

const request = (origin = 'http://localhost:3092') => ({
  headers: { host: 'localhost:3092', origin, 'sec-fetch-site': 'same-origin' },
}) as unknown as NextApiRequest
const errorCode = (code: string) => (error: unknown) => error instanceof TRPCError && error.code === code
const input = { observedAt: new Date('2026-07-26T06:34:00.000Z'), tool: 'coutelas' as const, idempotencyKey: 'history-api-request' }

test('historical appearance API denies visitors, non-admin users and foreign origins', async () => {
  const visitor = appRouter.createCaller({ req: request(), userId: null, isAdmin: false })
  await assert.rejects(visitor.addHistoricalAppearance(input), errorCode('UNAUTHORIZED'))
  const player = appRouter.createCaller({ req: request(), userId: 'player', isAdmin: false })
  await assert.rejects(player.addHistoricalAppearance(input), errorCode('FORBIDDEN'))
  const foreign = appRouter.createCaller({ req: request('https://elsewhere.example'), userId: 'admin', isAdmin: true })
  await assert.rejects(foreign.addHistoricalAppearance(input), errorCode('FORBIDDEN'))
})

test('authorized history API records the server administrator identity and is idempotent', async t => {
  t.after(async () => {
    getDatabaseClient(env).close()
    await rm(directory, { recursive: true, force: true })
  })
  const admin = appRouter.createCaller({ req: request(), userId: 'admin', isAdmin: true })
  const before = await admin.game()
  const appearance = await admin.addHistoricalAppearance(input)
  assert.deepEqual(await admin.addHistoricalAppearance(input), appearance)
  const game = await admin.game()
  assert.equal(game.history.length, 1)
  assert.deepEqual(game.round, before.round)
  const receipt = (await getDatabaseClient(env).execute('SELECT actor_clerk_user_id FROM scolo_history_additions')).rows[0]!
  assert.equal(receipt.actor_clerk_user_id, 'admin')
  assert.equal((await getDatabaseClient(env).execute('SELECT COUNT(*) AS total FROM scolo_tweet_outbox')).rows[0]!.total, 0)
})
