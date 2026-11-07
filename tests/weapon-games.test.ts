import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClient } from '@libsql/client'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { advanceWeapon, createWeaponRun, recordWeaponInput, replayWeapon, weaponInput, type Input, type WeaponGame } from '../src/game/weapons/engine'
import { createArcadeService } from '../src/server/arcade/service'
import { prepareGameDatabase } from '../scripts/prepare-game-db'

function missAll(seed: number) {
  const run = createWeaponRun('coutelas', seed), actions: Input[] = []
  while (run.status === 'running') {
    if (!run.shots.length) {
      const input = { at: run.tick, angle: 15, power: 10 }
      assert.ok(weaponInput(run, input)); actions.push(input)
    }
    advanceWeapon(run, run.tick + 20)
  }
  return { run, actions }
}
test('coutelas replay preserves three misses, rejects early results and invalid launches', () => {
  const { run, actions } = missAll(42)
  assert.equal(run.attempts, 0); assert.equal(run.marks.length, 3)
  assert.deepEqual(replayWeapon('coutelas', 42, actions, run.tick), run)
  assert.throws(() => replayWeapon('coutelas', 42, actions, run.tick - 20))
  const initial = createWeaponRun('coutelas', 42)
  assert.equal(weaponInput(initial, { at: 0, angle: 0, power: 100 }), false)
  assert.equal(weaponInput(initial, { at: 0, angle: 90, power: 100 }), true)
  assert.equal(weaponInput(initial, { at: 0, angle: 90, power: 100 }), false)
})
test('coutelas targets are reachable and reward first-shot precision', () => {
  for (let seed = 1; seed <= 20; seed++) {
    let won = false
    for (let angle = 25; angle <= 155 && !won; angle += 2) for (let power = 20; power <= 100 && !won; power += 2) {
      const run = createWeaponRun('coutelas', seed)
      weaponInput(run, { at: 0, angle, power }); advanceWeapon(run, 4000)
      if (run.hits) { assert.equal(run.score, 300); won = true }
    }
    assert.ok(won, `reachable target for seed ${seed}`)
  }
})
test('Digrain pressure empties and only resumes firing after release, replay is deterministic', () => {
  const run = createWeaponRun('digrain', 42)
  weaponInput(run, { at: 0, x: 160, fire: true }); advanceWeapon(run, 5000)
  assert.equal(run.exhausted, true)
  const hits = run.hits; advanceWeapon(run, 7000)
  assert.equal(run.hits, hits)
  weaponInput(run, { at: run.tick, fire: false }); advanceWeapon(run, 9000)
  assert.equal(run.exhausted, false); assert.equal(run.pressure, 100)
  const other = createWeaponRun('digrain', 42)
  advanceWeapon(other, 180000)
  assert.deepEqual(replayWeapon('digrain', 42, [], other.tick), other)
})
test('per-game receipts, rankings and podium caps are isolated and idempotent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scolo-weapons-'))
  const client = createClient({ url: `file:${join(directory, 'test.db')}` })
  let now = 1000000
  try {
    const games = await Promise.all((['sandale', 'digrain', 'coutelas'] as const).map(game => createArcadeService(client, () => now, { game })))
    for (const [i, game] of (['digrain', 'coutelas'] as WeaponGame[]).entries()) {
      const service = games[i + 1]!, session = await service.start('owner', game)
      const result = game === 'coutelas' ? missAll(session.seed) : { run: createWeaponRun(game, session.seed), actions: [] }
      if (game === 'digrain') advanceWeapon(result.run, 180000)
      now += result.run.tick + 1000
      const input = { token: session.token, elapsedMs: result.run.tick, actions: result.actions }
      const finished = await service.finish(input, 'owner')
      assert.equal(finished.points, result.run.score)
      await assert.rejects(games[0]!.finish(input, 'owner'), /version/)
      await assert.rejects(service.claim(session.token, 'other', 'Other'), /autre compte/)
      assert.equal((await service.claim(session.token, 'owner', 'Owner')).reward.credited, 3)
      assert.equal((await service.claim(session.token, 'owner', 'Owner')).reward.credited, 0)
      assert.equal((await service.reward('owner', 'Owner')).credited, 0)
      assert.equal((await service.standings('owner', session.token)).entries[0]?.points, result.run.score)
    }
    assert.equal((await games[0]!.leaderboard('owner')).entries.length, 0)
    const entries = (await client.execute("SELECT reference,amount FROM scolo_wallet_entries WHERE kind='arcade_bonus'")).rows
    assert.equal(entries.length, 2); assert.equal(entries.reduce((total, row) => total + Number(row.amount), 0), 6)
    assert.equal((await client.execute('SELECT COUNT(*) AS n FROM scolo_arcade_rewards')).rows[0]?.n, 0)
  } finally { client.close(); await rm(directory, { recursive:true, force:true }) }
})
test('additive migration preserves historical sandale scores, rewards and ledger on repeated application', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scolo-weapon-migration-'))
  const client = createClient({ url: `file:${join(directory, 'test.db')}` })
  try {
    await createArcadeService(client)
    // Recreate the old layout without the new columns, with a historical run.
    await client.execute('ALTER TABLE scolo_arcade_runs DROP COLUMN points')
    await client.execute('ALTER TABLE scolo_arcade_bests DROP COLUMN points')
    await client.execute("INSERT INTO scolo_arcade_runs (id,token_hash,rules,seed,started_at,rate_key,elapsed_ms,crushed) VALUES ('old','old-hash','sandale-v3',42,0,'old',1234,7)")
    await client.execute("INSERT INTO scolo_players(id,clerk_user_id,display_name,created_at) VALUES('legacy-player','legacy-user','Legacy fixture',1)")
    await client.execute("INSERT INTO scolo_wallets(player_id,balance) VALUES('legacy-player',3)")
    await client.execute("INSERT INTO scolo_arcade_rewards(user_id,player_id,total,updated_at) VALUES('legacy-user','legacy-player',3,1)")
    await client.execute("INSERT INTO scolo_wallet_entries(id,player_id,amount,kind,reference,created_at) VALUES('legacy-entry','legacy-player',3,'arcade_bonus','arcade:sandale:podium:legacy-player:3',1)")
    await client.execute("INSERT INTO scolo_arcade_bests(rules,user_id,display_name,elapsed_ms,crushed,claimed_at,run_id) VALUES('sandale-v3','legacy-user','Legacy fixture',1234,7,1,'old')")
    const before = (await client.execute('SELECT * FROM scolo_arcade_runs')).rows[0]!
    assert.equal((await prepareGameDatabase(client)).applied, false)
    assert.equal((await prepareGameDatabase(client, { apply:true })).applied, true)
    await prepareGameDatabase(client, { apply:true })
    const after = (await client.execute('SELECT * FROM scolo_arcade_runs')).rows[0]!
    for (const key of Object.keys(before)) assert.equal(after[key], before[key])
    assert.equal(after.points, 0)
    assert.equal((await client.execute('SELECT total FROM scolo_arcade_rewards')).rows[0]?.total,3)
    assert.equal((await client.execute('SELECT balance FROM scolo_wallets')).rows[0]?.balance,3)
    assert.equal((await client.execute('SELECT elapsed_ms FROM scolo_arcade_bests')).rows[0]?.elapsed_ms,1234)
  } finally { client.close(); await rm(directory, { recursive:true, force:true }) }
})

test('high-frequency pointer moves stay bounded and same-tick release/repress replays correctly', () => {
  const run = createWeaponRun('digrain', 42), actions: Input[] = []
  recordWeaponInput(run, actions, {fire:true})
  advanceWeapon(run, 5000)
  assert.equal(run.exhausted, true)
  recordWeaponInput(run, actions, {fire:false})
  for(let i=0;i<500;i++) recordWeaponInput(run, actions, {x:50+i%200})
  recordWeaponInput(run, actions, {fire:true})
  assert.equal(actions.length,3)
  advanceWeapon(run,180000)
  assert.deepEqual(replayWeapon('digrain',42,actions,run.tick),run)
})
