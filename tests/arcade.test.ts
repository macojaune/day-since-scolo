import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClient, type Client } from '@libsql/client'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { advanceRun, createRun, strike } from '../src/game/sandale/engine'
import type { FinishedRun } from '../src/game/sandale/protocol'
import { ArcadeError, createArcadeService } from '../src/server/arcade/service'
import { createGameService } from '../src/server/game/service'

function completed(session: { seed: number; token: string }, playUntil = 6000): FinishedRun {
  const run = createRun(session.seed)
  const actions: FinishedRun['actions'] = []
  while (run.status === 'running') {
    advanceRun(run, 20)
    if (run.elapsedMs < playUntil && run.bugs.length && run.elapsedMs >= run.nextStrikeAt) {
      const bug = run.bugs[0]!
      if (strike(run, bug.id).accepted) actions.push({ at: run.elapsedMs, bugId: bug.id })
    }
  }
  return { token: session.token, elapsedMs: run.elapsedMs, actions }
}

test('anonymous result survives service recreation and is claimable once after login', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scolo-arcade-'))
  const client = createClient({ url: `file:${join(directory, 'test.db')}` })
  let now = 100000
  try {
    const first = await createArcadeService(client, () => now)
    const session = await first.start(null, 'browser-a')
    const input = completed(session)
    now += input.elapsedMs + 1000
    const receipt = await first.finish(input, null)
    assert.deepEqual(await first.finish(input, null), receipt)
    const resumed = await createArcadeService(client, () => now)
    assert.equal((await resumed.pending(session.token, null))?.id, receipt.id)
    assert.equal((await resumed.claim(session.token, 'clerk-a', 'Player A')).claimed, true)
    assert.equal((await resumed.claim(session.token, 'clerk-a', 'Player A')).claimed, true)
    await assert.rejects(resumed.claim(session.token, 'clerk-b', 'Player B'), error => error instanceof ArcadeError && error.code === 'FORBIDDEN')
    assert.equal((await resumed.pending(session.token, 'clerk-a'))?.claimed, true)
    assert.equal(await resumed.pending(session.token, null), null)
    assert.equal(await resumed.pending(session.token, 'clerk-b'), null)
    const board = await resumed.leaderboard('clerk-a')
    assert.equal(board.entries.length, 1)
    assert.equal(board.me?.rank, 1)
    assert.equal(board.entries[0]!.name, 'Player A')
    assert.equal('user_id' in board.entries[0]!, false)
    assert.equal('token' in board.entries[0]!, false)
  } finally { client.close(); await rm(directory, { recursive: true, force: true }) }
})

test('fabricated duration, impossible hits and altered retry are rejected; account ownership holds', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scolo-arcade-'))
  const client = createClient({ url: `file:${join(directory, 'test.db')}` })
  let now = 100000
  try {
    const service = await createArcadeService(client, () => now)
    const session = await service.start('owner', 'browser-b')
    const input = completed(session)
    await assert.rejects(service.finish(input, 'owner'), /temps/)
    now += input.elapsedMs + 1000
    await assert.rejects(service.finish(input, 'other'), error => error instanceof ArcadeError && error.code === 'FORBIDDEN')
    await assert.rejects(service.finish({ ...input, actions: [{ at: 100, bugId: 999 }] }, 'owner'), /coup/)
    await assert.rejects(service.finish({ ...input, elapsedMs: 100 }, 'owner'), /Ordre|terminée/)
    await service.finish(input, 'owner')
    await assert.rejects(service.finish({ ...input, elapsedMs: input.elapsedMs + 1 }, 'owner'), /autre résultat/)
    await assert.rejects(service.claim(session.token, 'other', 'Other'), /autre compte/)
    assert.equal((await service.leaderboard(null)).entries.length, 0)
  } finally { client.close(); await rm(directory, { recursive: true, force: true }) }
})

test('one best per player, bounded podium credit and bounded start rate', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scolo-arcade-'))
  const client = createClient({ url: `file:${join(directory, 'test.db')}` })
  let now = 100000
  try {
    const service = await createArcadeService(client, () => now)
    for (const [userId, until] of [['a', 7000], ['b', 12000], ['a', 0]] as const) {
      const session = await service.start(userId, userId)
      const input = completed(session, until)
      now += input.elapsedMs + 1000
      await service.finish(input, userId)
      await service.claim(session.token, userId, `Player ${userId}`)
    }
    const board = await service.leaderboard('a')
    assert.equal(board.entries.length, 2)
    assert.equal(board.entries[0]!.name, 'Player b')
    assert.equal(board.me?.rank, 2)
    assert.ok(board.me!.elapsedMs > 7000)
    const credits = (await client.execute("SELECT player_id,SUM(amount) AS total FROM scolo_wallet_entries WHERE kind='arcade_bonus' GROUP BY player_id")).rows
    assert.equal(credits.length, 2)
    assert.ok(credits.every(row => Number(row.total) <= 3))
    for (let i = 0; i < 40; i++) await service.start(null, 'burst')
    await assert.rejects(service.start(null, 'burst'), error => error instanceof ArcadeError && error.code === 'TOO_MANY_REQUESTS')
  } finally { client.close(); await rm(directory, { recursive: true, force: true }) }
  await assert.rejects(createArcadeService({ protocol: 'https' } as Client), /SQLite local/)
})

test('ties preserve the first result and simultaneous claims never give a run to two accounts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scolo-arcade-race-'))
  const client = createClient({ url: `file:${join(directory, 'test.db')}` })
  let now = 100000
  try {
    const service = await createArcadeService(client, () => now)
    for (const user of ['first', 'second']) {
      const session = await service.start(user, user)
      await client.execute({ sql: 'UPDATE scolo_arcade_runs SET seed=42 WHERE token_hash IS NOT NULL AND started_at=? AND owner_id=?', args: [now, user] })
      const input = completed({ ...session, seed: 42 })
      now += input.elapsedMs + 1000
      await service.finish(input, user)
      await service.claim(session.token, user, user)
    }
    const tied = await service.leaderboard(null)
    assert.equal(tied.entries[0]!.elapsedMs, tied.entries[1]!.elapsedMs)
    assert.equal(tied.entries[0]!.name, 'first')
    const session = await service.start(null, 'concurrency')
    const input = completed(session)
    now += input.elapsedMs + 1000
    await service.finish(input, null)
    const attempts = await Promise.allSettled([service.claim(session.token, 'left', 'Left'), service.claim(session.token, 'right', 'Right')])
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1)
    const owner = (await client.execute({ sql: 'SELECT claimed_by FROM scolo_arcade_runs WHERE id=(SELECT run_id FROM scolo_arcade_bests WHERE user_id IN (?,?))', args: ['left', 'right'] })).rows[0]!.claimed_by
    const other = owner === 'left' ? 'right' : 'left'
    await assert.rejects(service.claim(session.token, other, other), error => error instanceof ArcadeError && error.code === 'FORBIDDEN')
  } finally { client.close(); await rm(directory, { recursive: true, force: true }) }
})

test('podium pays only the incremental best tier, never refills after drops or a ruleset change', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scolo-podium-'))
  const client = createClient({ url: `file:${join(directory, 'test.db')}` })
  let now = 100000
  try {
    const service = await createArcadeService(client, () => now)
    const play = async (user: string, until: number) => {
      const session = await service.start(user, user)
      const input = completed(session, until)
      now += input.elapsedMs + 1000
      await service.finish(input, user)
      return { session, result: await service.claim(session.token, user, user) }
    }
    await play('leader', 15000)
    await play('runner', 12000)
    assert.equal((await play('climber', 8000)).result.reward.credited, 1)
    assert.equal((await play('climber', 14000)).result.reward.credited, 1)
    const first = await play('climber', 18000)
    assert.equal(first.result.reward.credited, 1)
    for (let i = 0; i < 5; i++) assert.equal((await service.claim(first.session.token, 'climber', 'climber')).reward.credited, 0)
    await play('leader', 22000)
    await play('runner', 24000)
    assert.equal((await play('climber', 26000)).result.reward.credited, 0)
    assert.deepEqual((await client.execute("SELECT amount FROM scolo_wallet_entries e JOIN scolo_players p ON p.id=e.player_id WHERE p.clerk_user_id='climber' AND kind='arcade_bonus' ORDER BY e.rowid")).rows.map(row => Number(row.amount)), [1, 1, 1])
    const board = await service.leaderboard('climber')
    assert.deepEqual(board.reward, { total: 3, available: 0, cap: 3 })
    await client.execute("UPDATE scolo_arcade_bests SET rules='previous-version'")
    assert.equal((await play('climber', 0)).result.reward.credited, 0)
    assert.equal((await service.leaderboard('climber')).reward?.total, 3)
  } finally { client.close(); await rm(directory, { recursive: true, force: true }) }
})

test('a failed credit rolls back the claim; enrollment and reward share one welcome balance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scolo-podium-atomic-'))
  const client = createClient({ url: `file:${join(directory, 'test.db')}` })
  let now = 100000
  try {
    const service = await createArcadeService(client, () => now)
    const game = await createGameService(client)
    const session = await service.start('new-player', 'new-player')
    const input = completed(session)
    now += input.elapsedMs + 1000
    await service.finish(input, 'new-player')
    await client.execute("CREATE TRIGGER reject_arcade_reward BEFORE INSERT ON scolo_wallet_entries WHEN NEW.kind='arcade_bonus' BEGIN SELECT RAISE(ABORT,'reward_failed'); END")
    await assert.rejects(service.claim(session.token, 'new-player', 'new-player'), /reward_failed/)
    assert.equal((await service.leaderboard('new-player')).me, null)
    assert.equal((await client.execute('SELECT COUNT(*) AS n FROM scolo_players')).rows[0]!.n, 0)
    await client.execute('DROP TRIGGER reject_arcade_reward')
    await Promise.all([game.ensurePlayer({ userId: 'new-player', displayName: 'new-player' }), service.claim(session.token, 'new-player', 'new-player')])
    await Promise.all([service.reward('new-player', 'new-player'), service.reward('new-player', 'new-player')])
    assert.equal((await game.getPlayerGame('new-player')).balance, 6)
    assert.equal((await client.execute("SELECT COUNT(*) AS n FROM scolo_wallet_entries WHERE kind='welcome'")).rows[0]!.n, 1)
    assert.equal((await client.execute("SELECT SUM(amount) AS n FROM scolo_wallet_entries WHERE kind='arcade_bonus'")).rows[0]!.n, 3)
  } finally { client.close(); await rm(directory, { recursive: true, force: true }) }
})

test('latest run has its own private rank and paged neighbors without replacing the permanent best', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scolo-standings-'))
  const client = createClient({ url: `file:${join(directory, 'test.db')}` })
  let now = 100000
  try {
    const service = await createArcadeService(client, () => now)
    const session = await service.start('owner', 'rank-test')
    const input = completed(session, 0)
    now += input.elapsedMs + 1000
    const current = await service.finish(input, 'owner')
    for (let i = 0; i < 45; i++) {
      const id = `fixture-${i}`
      await client.execute({ sql: 'INSERT INTO scolo_arcade_runs (id,token_hash,rules,seed,started_at,rate_key) VALUES (?,?,?,1,1,?)', args: [id, id, 'sandale-v3', id] })
      const elapsed = i === 0 ? 50000 : i < 40 ? current.elapsedMs + 1000 + i : current.elapsedMs - 1000 - i
      await client.execute({ sql: 'INSERT INTO scolo_arcade_bests (rules,user_id,display_name,elapsed_ms,crushed,claimed_at,run_id) VALUES (?,?,?,?,0,1,?)', args: ['sandale-v3', i === 0 ? 'owner' : id, i === 0 ? 'Owner' : id, elapsed, id] })
    }
    const before = await service.leaderboard('owner')
    const view = await service.standings('owner', session.token)
    assert.equal(view.sessionId, current.id)
    assert.equal(view.me?.rank, 40)
    assert.equal(view.me?.elapsedMs, current.elapsedMs)
    assert.equal(view.total, 45)
    assert.equal(view.offset, 30)
    assert.equal(view.entries.filter(entry => entry.isMe).length, 1)
    assert.ok(view.entries.every(entry => !('user_id' in entry) && !('run_id' in entry)))
    assert.equal((await service.standings('owner', session.token, 0)).entries[0]!.rank, 1)
    assert.equal((await service.standings('owner', session.token, 20)).entries[0]!.rank, 21)
    assert.equal((await service.standings('other', session.token)).sessionId, null)
    assert.equal((await service.standings(null, session.token)).sessionId, null)
    assert.deepEqual(await service.leaderboard('owner'), before)
    assert.equal(before.me?.rank, 1)
  } finally { client.close(); await rm(directory, { recursive: true, force: true }) }
})

test('hosted arcade requires explicit preparation and performs no runtime DDL', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scolo-hosted-arcade-'))
  const client = createClient({ url: `file:${join(directory, 'test.db')}` })
  let now = 100000
  try {
    const calls: string[] = []
    const hosted = new Proxy(client, { get(target, key) {
      if (key === 'protocol') return 'https'
      if (key === 'execute') return (statement: Parameters<Client['execute']>[0]) => {
        calls.push(typeof statement === 'string' ? statement : statement.sql)
        return target.execute(statement)
      }
      const value: unknown = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    } })
    await assert.rejects(createArcadeService(hosted, () => now, { allowHosted: true }), /no such table/)
    await createGameService(client)
    calls.length = 0
    const service = await createArcadeService(hosted, () => now, { allowHosted: true })
    const session = await service.start('hosted-player', 'hosted-player')
    const input = completed(session)
    now += input.elapsedMs + 1000
    await service.finish(input, 'hosted-player')
    assert.equal((await service.claim(session.token, 'hosted-player', 'Hosted test')).reward.credited, 3)
    assert.equal((await service.claim(session.token, 'hosted-player', 'Hosted test')).reward.credited, 0)
    assert.ok(calls.every(sql => !/^(?:CREATE|ALTER|DROP|PRAGMA)/i.test(sql)))
  } finally { client.close(); await rm(directory, { recursive: true, force: true }) }
})
