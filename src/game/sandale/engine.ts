/** Pure, elapsed-time simulation. No wallet, network, or frame-rate-dependent scoring. */
export type Lane = 0 | 1 | 2
export type Bug = { id: number; lane: Lane; progress: number; travelMs: number; variant: number }
export type Run = {
  elapsedMs: number
  bugs: Bug[]
  crushed: number
  swings: number
  nextStrikeAt: number
  nextSpawnAt: number
  nextId: number
  randomState: number
  lastLane: Lane
  status: 'running' | 'lost'
  introCount: number
  pressureAt: number | null
}
export type RecordScore = { elapsedMs: number; crushed: number }

export const STRIKE_RECOVERY_MS = 190
export const SCORE_RULESET = 'sandale-v3'
export const RECORD_KEY = 'scolo:sandale:personal-best:v3'
export const SCOLO_VARIANTS = ['noir', 'bleu', 'jaune', 'rouge', 'doré'] as const

export function createRun(seed: number): Run {
  const run: Run = {
    elapsedMs: 0, bugs: [], crushed: 0, swings: 0, nextStrikeAt: 0,
    nextSpawnAt: 500, nextId: 1, randomState: (seed >>> 0) || 1,
    lastLane: 2, status: 'running', introCount: 3, pressureAt: null,
  }
  run.introCount = 3 + Math.floor(random(run) * 5)
  return run
}

function random(run: Run) {
  let value = run.randomState
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  run.randomState = value >>> 0
  return run.randomState / 4294967296
}

export function difficulty(elapsedMs: number, pressureAt: number | null = 3000) {
  if (pressureAt === null || elapsedMs < pressureAt) return { intervalMs: 750, travelMs: 3000, level: 1 }
  const pressure = (elapsedMs - pressureAt) / 1000
  return {
    intervalMs: 280 + 250 * Math.exp(-pressure / 8),
    travelMs: 750 + 900 * Math.exp(-pressure / 10),
    level: Math.min(6, 2 + Math.floor(pressure / 5)),
  }
}

function spawn(run: Run) {
  // One target per passage keeps the small weapon slot legible and tappable.
  const available = ([0, 1, 2] as const).filter(lane =>
    !run.bugs.some(bug => bug.lane === lane))
  const alternatives = available.filter(lane => lane !== run.lastLane)
  const lanes = alternatives.length ? alternatives : available
  if (!lanes.length) return
  if (run.nextId > run.introCount && run.pressureAt === null) run.pressureAt = run.elapsedMs
  const lane = lanes[Math.floor(random(run) * lanes.length)] ?? 0
  const travelMs = difficulty(run.elapsedMs, run.pressureAt).travelMs * (0.96 + random(run) * 0.08)
  run.bugs.push({ id: run.nextId++, lane, progress: 0, travelMs, variant: Math.floor(random(run) * SCOLO_VARIANTS.length) })
  run.lastLane = lane
}

export function advanceRun(run: Run, deltaMs: number): void {
  if (run.status !== 'running' || !Number.isFinite(deltaMs) || deltaMs <= 0) return
  const until = run.elapsedMs + deltaMs
  // Resolve spawn and goal events at their exact time, regardless of display refresh rate.
  while (run.elapsedMs < until && run.status === 'running') {
    const arrivalAt = run.bugs.reduce((earliest, bug) =>
      Math.min(earliest, run.elapsedMs + (1 - bug.progress) * bug.travelMs), Infinity)
    const eventAt = Math.min(until, run.nextSpawnAt, arrivalAt)
    const step = Math.max(0, eventAt - run.elapsedMs)
    for (const bug of run.bugs) bug.progress = Math.min(1, bug.progress + step / bug.travelMs)
    run.elapsedMs = eventAt
    if (run.bugs.some(bug => bug.progress >= 1 - 1e-10)) {
      run.status = 'lost'
      return
    }
    if (run.elapsedMs >= run.nextSpawnAt) {
      spawn(run)
      run.nextSpawnAt = run.elapsedMs + difficulty(run.elapsedMs, run.pressureAt).intervalMs * (0.85 + random(run) * 0.3)
    }
  }
}

export function strike(run: Run, bugId?: number): { accepted: boolean; hit: boolean } {
  if (run.status !== 'running' || run.elapsedMs < run.nextStrikeAt) return { accepted: false, hit: false }
  run.nextStrikeAt = run.elapsedMs + STRIKE_RECOVERY_MS
  run.swings++
  const index = run.bugs.findIndex(bug => bug.id === bugId)
  if (index === -1) return { accepted: true, hit: false }
  run.bugs.splice(index, 1)
  run.crushed++
  return { accepted: true, hit: true }
}

export function bestTarget(run: Run, lane: Lane): Bug | undefined {
  return run.bugs.filter(bug => bug.lane === lane).sort((a, b) => b.progress - a.progress)[0]
}

export function beatsRecord(score: RecordScore, previous: RecordScore | null): boolean {
  return !previous || score.elapsedMs > previous.elapsedMs ||
    (score.elapsedMs === previous.elapsedMs && score.crushed > previous.crushed)
}

export function readRecord(raw: string | null): RecordScore | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<RecordScore> | null
    if (!value || typeof value.elapsedMs !== 'number' || !Number.isSafeInteger(value.elapsedMs) ||
      value.elapsedMs <= 0 || typeof value.crushed !== 'number' ||
      !Number.isSafeInteger(value.crushed) || value.crushed < 0) return null
    return { elapsedMs: value.elapsedMs, crushed: value.crushed }
  } catch { return null }
}

export function formatDuration(ms: number): string {
  const tenths = Math.floor(ms / 100)
  return `${String(Math.floor(tenths / 600)).padStart(2, '0')}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`
}
