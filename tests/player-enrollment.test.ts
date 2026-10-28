import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { createClient } from '@libsql/client'
import { createGameService } from '../src/server/game/service'

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'scolo-enrollment-test-'))
  const client = createClient({ url: `file:${join(directory, 'test.db')}` })
  t.after(async () => {
    client.close()
    await rm(directory, { recursive: true, force: true })
  })
  const service = await createGameService(client)
  return { client, service }
}

test('enrollment distinguishes a new player from a returning player without changing the welcome bonus', async t => {
  const { client, service } = await fixture(t)
  const first = await service.ensurePlayer({ userId: 'enrollment-alice', displayName: 'Alice' })
  const returning = await service.ensurePlayer({ userId: 'enrollment-alice', displayName: 'Alice' })

  assert.equal(first.created, true)
  assert.deepEqual(returning, { ...first, created: false })
  assert.equal(first.balance, 3)
  const entries = await client.execute("SELECT amount FROM scolo_wallet_entries WHERE kind = 'welcome'")
  assert.deepEqual(entries.rows.map(row => Number(row.amount)), [3])
})

test('concurrent enrollments report exactly one creation and preserve a single player and wallet', async t => {
  const { client, service } = await fixture(t)
  const results = await Promise.all(Array.from({ length: 12 }, () => service.ensurePlayer({ userId: 'enrollment-bob' })))

  assert.equal(results.filter(result => result.created).length, 1)
  assert.equal(new Set(results.map(result => result.id)).size, 1)
  assert.ok(results.every(result => result.balance === 3))
  for (const table of ['scolo_players', 'scolo_wallets', 'scolo_wallet_entries']) {
    const count = await client.execute(`SELECT COUNT(*) AS total FROM ${table}`)
    assert.equal(Number(count.rows[0]!.total), 1)
  }
  assert.equal((await service.ensurePlayer({ userId: 'enrollment-bob' })).created, false)
})
