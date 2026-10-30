import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createClient, type InStatement } from '@libsql/client'
import { prepareGameDatabase } from '../scripts/prepare-game-db'
import { migrateGameDatabase } from '../src/server/db/local-migrations'

const admin = { adminClerkId: 'user_testAdmin', adminName: 'macojaune' }
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'scolo-preparation-'))
  const path = join(directory, 'copy.db')
  const client = createClient({ url: `file:${path}` })
  t.after(async () => { client.close(); await rm(directory, { recursive: true, force: true }) })
  await client.batch([
    'CREATE TABLE "scolo-data" (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER, tool TEXT)',
    "INSERT INTO \"scolo-data\" VALUES (67, 1793157000, 'sandale')",
    'CREATE TABLE credits (id INTEGER PRIMARY KEY, newCredit INTEGER)',
    'INSERT INTO credits VALUES (77, 999)',
  ], 'write')
  return { client, path }
}

test('default preparation is read-only and reports the exact intended admin creation', async t => {
  const { client } = await fixture(t)
  const schema = (await client.execute('SELECT * FROM sqlite_master ORDER BY name')).rows
  const report = await prepareGameDatabase(client, admin)
  assert.equal(report.applied, false)
  assert.equal(report.plan.administrator?.action, 'create-player-with-3-zikak')
  assert.equal(report.plan.opensRound, false)
  assert.ok(report.plan.tablesToCreate.includes('scolo_wallet_entries'))
  assert.deepEqual((await client.execute('SELECT * FROM sqlite_master ORDER BY name')).rows, schema)
})

test('remote migration does not send SQLite-only busy_timeout to the HTTP service', async t => {
  const { client } = await fixture(t)
  const before = (await client.execute('SELECT * FROM "scolo-data"')).rows
  const remote = new Proxy({} as typeof client, {
    get(_target, property) {
      if (property === 'protocol') return 'http'
      if (property === 'execute') return async (statement: InStatement) => {
        const sql = typeof statement === 'string' ? statement : statement.sql
        assert.doesNotMatch(sql, /busy_timeout/i, 'Turso rejects this connection-local PRAGMA')
        return client.execute(statement)
      }
      const value = Reflect.get(client, property)
      return typeof value === 'function' ? value.bind(client) : value
    },
  })
  await prepareGameDatabase(remote, { ...admin, apply: true })
  assert.deepEqual((await client.execute('SELECT * FROM "scolo-data"')).rows, before)
  assert.equal((await client.execute('SELECT balance FROM scolo_wallets')).rows[0]!.balance, 3)
  assert.equal((await client.execute('SELECT COUNT(*) AS n FROM scolo_rounds')).rows[0]!.n, 0)
})

test('explicit preparation creates one welcome balance without a round and is idempotent', async t => {
  const { client } = await fixture(t)
  const original = (await client.execute('SELECT * FROM "scolo-data"')).rows
  await prepareGameDatabase(client, { ...admin, apply: true })
  const first = await prepareGameDatabase(client, admin)
  const second = await prepareGameDatabase(client, { ...admin, apply: true })
  assert.equal(second.plan.administrator?.action, 'keep-existing')
  assert.deepEqual((await prepareGameDatabase(client, admin)).tables, first.tables)
  assert.equal((await client.execute('SELECT COUNT(*) AS n FROM scolo_players')).rows[0]!.n, 1)
  assert.equal((await client.execute('SELECT balance FROM scolo_wallets')).rows[0]!.balance, 3)
  assert.equal((await client.execute("SELECT COUNT(*) AS n FROM scolo_wallet_entries WHERE kind = 'welcome' AND amount = 3")).rows[0]!.n, 1)
  for (const name of ['scolo_rounds', 'scolo_predictions', 'scolo_settlements', 'scolo_tweet_outbox']) {
    assert.equal((await client.execute(`SELECT COUNT(*) AS n FROM ${name}`)).rows[0]!.n, 0)
  }
  assert.deepEqual((await client.execute('SELECT * FROM "scolo-data"')).rows, original)
  assert.equal((await client.execute('SELECT newCredit FROM credits WHERE id = 77')).rows[0]!.newCredit, 999)
})

test('repeating preparation never refills a previously used balance or changes its identity', async t => {
  const { client } = await fixture(t)
  await prepareGameDatabase(client, { ...admin, apply: true })
  await client.execute('UPDATE scolo_wallets SET balance = 1 WHERE balance = 3')
  await prepareGameDatabase(client, { ...admin, adminName: 'different-name', apply: true })
  assert.equal((await client.execute('SELECT balance FROM scolo_wallets')).rows[0]!.balance, 1)
  assert.equal((await client.execute('SELECT display_name FROM scolo_players')).rows[0]!.display_name, 'macojaune')
  assert.equal((await client.execute('SELECT COUNT(*) AS n FROM scolo_wallet_entries')).rows[0]!.n, 1)
})

test('Buffer migration preserves legacy X receipts and uncertain attempts without enqueueing history', async t => {
  const { client } = await fixture(t)
  await prepareGameDatabase(client, { apply: true })
  await client.execute('DROP TABLE scolo_buffer_posts')
  await client.execute("INSERT INTO scolo_tweet_outbox (appearance_id,content,status,created_at,attempted_at,published_at,tweet_id,error_code) VALUES (67,'Original published text','sent',100,101,102,'987654321',NULL)")
  await client.execute("INSERT INTO \"scolo-data\" VALUES (68,1793157100,'coutelas')")
  await client.execute("INSERT INTO scolo_tweet_outbox (appearance_id,content,status,created_at,error_code) VALUES (68,'Original uncertain text','unknown',103,'TWITTER_NETWORK_OUTCOME_UNKNOWN')")
  const before = (await client.execute('SELECT * FROM scolo_tweet_outbox ORDER BY appearance_id')).rows
  const dryRun = await prepareGameDatabase(client)
  assert.ok(dryRun.plan.tablesToCreate.includes('scolo_buffer_posts'))
  await prepareGameDatabase(client, { apply: true })
  await prepareGameDatabase(client, { apply: true })
  assert.deepEqual((await client.execute('SELECT * FROM scolo_tweet_outbox ORDER BY appearance_id')).rows, before)
  assert.equal((await client.execute('SELECT COUNT(*) AS n FROM scolo_buffer_posts')).rows[0]!.n, 0)
  assert.equal((await client.execute('PRAGMA foreign_key_check')).rows.length, 0)
})

test('a welcome-ledger failure rolls back the new player and wallet', async t => {
  const { client } = await fixture(t)
  await migrateGameDatabase(client)
  await client.execute("CREATE TRIGGER fail_welcome BEFORE INSERT ON scolo_wallet_entries BEGIN SELECT RAISE(ABORT, 'test failure'); END")
  await assert.rejects(prepareGameDatabase(client, { ...admin, apply: true }), /test failure/)
  for (const name of ['scolo_players', 'scolo_wallets', 'scolo_wallet_entries', 'scolo_rounds']) {
    assert.equal((await client.execute(`SELECT COUNT(*) AS n FROM ${name}`)).rows[0]!.n, 0)
  }
})

test('CLI defaults to read-only and requires an explicit valid identity before writes', async t => {
  const { client, path } = await fixture(t)
  const script = resolve('scripts/prepare-game-db.ts')
  const environment = { ...process.env, DATABASE_URL: `file:${path}`, SCOLO_WALLET_MODE: 'local' }
  const output = execFileSync(process.execPath, ['--import', import.meta.resolve('tsx'), script, '--admin-clerk-id', admin.adminClerkId, '--admin-name', admin.adminName], { env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  assert.equal((JSON.parse(output) as { applied: boolean }).applied, false)
  assert.equal((await client.execute("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'scolo_players'")).rows[0]!.n, 0)
  assert.throws(() => execFileSync(process.execPath, ['--import', import.meta.resolve('tsx'), script, '--apply', '--admin-clerk-id', 'not-a-clerk-id', '--admin-name', 'Admin'], { env: environment, stdio: 'pipe' }))
  assert.equal((await client.execute("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'scolo_players'")).rows[0]!.n, 0)
})
