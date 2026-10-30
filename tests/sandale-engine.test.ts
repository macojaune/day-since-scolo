import assert from 'node:assert/strict'
import test from 'node:test'
import {
  advanceRun, beatsRecord, bestTarget, createRun, difficulty, formatDuration,
  readRecord, strike, STRIKE_RECOVERY_MS, SCOLO_VARIANTS,
} from '../src/game/sandale/engine'

test('first escape ends the game at the same instant at 30, 60, and 120 Hz', () => {
  const results = [30, 60, 120].map(hz => {
    const run = createRun(42)
    for (let i = 0; i < hz * 15 && run.status === 'running'; i++) advanceRun(run, 1000 / hz)
    assert.equal(run.status, 'lost')
    return run.elapsedMs
  })
  for (const result of results) assert.ok(Math.abs(result - results[0]!) < 0.0001)
})

test('a hit removes its target once and the recovery also applies to misses', () => {
  const run = createRun(4)
  advanceRun(run, 1000)
  const id = run.bugs[0]!.id
  assert.deepEqual(strike(run, id), { accepted: true, hit: true })
  assert.equal(run.crushed, 1)
  assert.equal(run.bugs.length, 0)
  assert.equal(strike(run, id).accepted, false)
  advanceRun(run, STRIKE_RECOVERY_MS)
  assert.deepEqual(strike(run, id), { accepted: true, hit: false })
  assert.equal(run.crushed, 1)
  assert.equal(run.swings, 2)
  assert.equal(strike(run).accepted, false)
})

test('surviving for two minutes increases difficulty while keeping target spacing', () => {
  const run = createRun(184)
  const variants = new Set<number>()
  for (let i = 0; i < 1200; i++) {
    advanceRun(run, 100)
    for (const bug of run.bugs) variants.add(bug.variant)
    if (run.elapsedMs >= run.nextStrikeAt && run.bugs.length) {
      const nearest = [...run.bugs].sort((a, b) => b.progress - a.progress)[0]!
      assert.equal(bestTarget(run, nearest.lane)?.id, nearest.id)
      strike(run, nearest.id)
    }
    assert.equal(run.status, 'running')
    for (const lane of [0, 1, 2]) {
      const bugs = run.bugs.filter(bug => bug.lane === lane).sort((a, b) => a.progress - b.progress)
      assert.ok(bugs.length <= 1, 'the compact slot keeps at most one target per passage')
      for (let j = 1; j < bugs.length; j++) assert.ok(bugs[j]!.progress - bugs[j - 1]!.progress > 0.15)
    }
  }
  assert.ok(run.crushed > 60)
  assert.equal(variants.size, SCOLO_VARIANTS.length)
  assert.ok(difficulty(120000).travelMs < difficulty(0).travelMs)
  assert.ok(difficulty(120000).intervalMs < difficulty(0).intervalMs)
  assert.ok(difficulty(999999).intervalMs > STRIKE_RECOVERY_MS * 1.4)
})

test('each seed draws three to seven introductory targets before a sharp, irregular ramp', () => {
  const counts = new Set<number>()
  for (let seed = 1; seed <= 50; seed++) {
    const run = createRun(Math.imul(seed, 0x9e3779b1))
    counts.add(run.introCount)
    assert.ok(run.introCount >= 3 && run.introCount <= 7)
    const arrivals: { at: number; travelMs: number }[] = []
    while (arrivals.length < run.introCount + 3) {
      advanceRun(run, 10)
      if (run.bugs.length) {
        const bug = run.bugs[0]!
        arrivals.push({ at: run.elapsedMs, travelMs: bug.travelMs })
        strike(run, bug.id)
      }
    }
    assert.ok(arrivals[run.introCount]!.at < 7000)
    assert.ok(arrivals[run.introCount]!.travelMs < arrivals[0]!.travelMs * 0.6)
    assert.ok(arrivals[run.introCount + 1]!.at - arrivals[run.introCount]!.at < 650)
    const gaps = arrivals.slice(1).map((arrival, i) => arrival.at - arrivals[i]!.at)
    assert.ok(new Set(gaps).size > 2)
  }
  assert.deepEqual([...counts].sort(), [3, 4, 5, 6, 7])
  assert.ok(difficulty(10000).travelMs < 1250)
  assert.ok(difficulty(20000).travelMs < difficulty(10000).travelMs)
})

test('seed reproduces a run and invalid elapsed times cannot move the simulation', () => {
  const one = createRun(198)
  const two = createRun(198)
  advanceRun(one, 4000)
  for (let i = 0; i < 40; i++) advanceRun(two, 100)
  assert.equal(one.bugs.length, two.bugs.length)
  for (let i = 0; i < one.bugs.length; i++) {
    assert.equal(one.bugs[i]!.lane, two.bugs[i]!.lane)
    assert.ok(Math.abs(one.bugs[i]!.progress - two.bugs[i]!.progress) < 1e-10)
  }
  const snapshot = JSON.stringify(one)
  for (const invalid of [0, -1, NaN, Infinity]) advanceRun(one, invalid)
  assert.equal(JSON.stringify(one), snapshot)
})

test('only a better run replaces the record, with crushed targets as tiebreak', () => {
  const record = { elapsedMs: 12000, crushed: 7 }
  assert.equal(beatsRecord(record, null), true)
  assert.equal(beatsRecord({ elapsedMs: 11000, crushed: 100 }, record), false)
  assert.equal(beatsRecord({ elapsedMs: 12000, crushed: 8 }, record), true)
  assert.equal(beatsRecord(record, record), false)
  assert.deepEqual(readRecord(JSON.stringify(record)), record)
  const longRun = { elapsedMs: 7 * 60 * 60 * 1000, crushed: 30000 }
  assert.deepEqual(readRecord(JSON.stringify(longRun)), longRun)
  for (const invalid of ['{}', 'null', '[]', 'broken', '{"elapsedMs":-1,"crushed":1}', '{"elapsedMs":1000,"crushed":0.5}']) {
    assert.equal(readRecord(invalid), null)
  }
  assert.equal(formatDuration(65199), '01:05.1')
})
