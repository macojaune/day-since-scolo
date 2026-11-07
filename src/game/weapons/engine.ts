/** Shared deterministic simulations. Fixed 20 ms steps are replayed on the server. */
export type WeaponGame = 'digrain' | 'coutelas'
export type Input = { at: number; x?: number; fire?: boolean; angle?: number; power?: number }
export type Target = { id: number; x: number; y: number }
export type Shot = { x: number; y: number; vx: number; vy: number; age: number }
export type WeaponRun = {
  game: WeaponGame; tick: number; random: number; status: 'running' | 'lost'; score: number;
  hits: number; lives: number; wave: number; targets: Target[]; shots: Shot[];
  marks: Target[]; x: number; fire: boolean; pressure: number; exhausted: boolean;
  nextShot: number; nextWave: number; attempts: number; throws: number; nextTarget: number;
}
export const STEP = 20
export const WIDTH = 320
export const HEIGHT = 400
export const MAX_TIME = 180000
export function random(run: WeaponRun) {
  let n = run.random; n ^= n << 13; n ^= n >>> 17; n ^= n << 5;
  run.random = n >>> 0; return run.random / 4294967296
}
function target(run: WeaponRun) {
  run.targets = [{ id: run.hits + 1, x: 48 + random(run) * 224, y: 70 + random(run) * 180 }]
  run.attempts = 3; run.throws = 0; run.marks = []
}
function wave(run: WeaponRun) {
  run.wave++
  run.targets = Array.from({ length: 15 }, (_, i) => ({ id: i, x: 52 + i % 5 * 52, y: 40 + Math.floor(i / 5) * 35 }))
}
export function createWeaponRun(game: WeaponGame, seed: number): WeaponRun {
  const run: WeaponRun = { game, tick: 0, random: seed || 1, status: 'running', score: 0, hits: 0,
    lives: 3, wave: 0, targets: [], shots: [], marks: [], x: 160, fire: false, pressure: 100,
    exhausted: false, nextShot: 0, nextWave: 0, attempts: 3, throws: 0, nextTarget: 0 }
  if (game === 'coutelas') target(run); else wave(run)
  return run
}
export function weaponInput(run: WeaponRun, input: Input): boolean {
  if (run.status !== 'running') return false
  if (run.game === 'digrain') {
    if (input.angle !== undefined || input.power !== undefined) return false
    if (input.x !== undefined) run.x = Math.max(18, Math.min(302, input.x))
    if (input.fire !== undefined) { run.fire = input.fire; if (!run.fire) run.exhausted = false }
    return true
  }
  if (input.x !== undefined || input.fire !== undefined || input.angle === undefined || input.power === undefined || run.shots.length || run.nextTarget > run.tick) return false
  if (input.angle < 15 || input.angle > 165 || input.power < 10 || input.power > 100) return false
  const angle = input.angle * Math.PI / 180, speed = 140 + input.power * 3.2
  run.shots.push({ x: 160, y: 370, vx: Math.cos(angle) * speed, vy: -Math.sin(angle) * speed, age: 0 })
  run.throws++; return true
}
function step(run: WeaponRun) {
  run.tick += STEP
  if (run.game === 'digrain') {
    const spraying = run.fire && !run.exhausted && run.pressure >= 4
    run.pressure = Math.max(0, Math.min(100, run.pressure + (spraying ? -0.65 : 0.38)))
    if (run.pressure < 4 && run.fire) run.exhausted = true
    if (spraying && run.tick >= run.nextShot) {
      run.shots.push({ x: run.x, y: 356, vx: 0, vy: -360, age: 0 }); run.nextShot = run.tick + 160
    }
    const dx = Math.sin(run.tick / 600) * (0.55 + Math.min(run.wave, 8) * 0.06)
    for (const bug of run.targets) { bug.x = Math.max(18, Math.min(302, bug.x + dx)); bug.y += 0.07 + run.wave * 0.018 }
    for (const shot of run.shots) {
      shot.y += shot.vy * .02; shot.age += STEP
      const index = run.targets.findIndex(bug => Math.abs(bug.x - shot.x) < 19 && Math.abs(bug.y - shot.y) < 12)
      if (index >= 0) { run.targets.splice(index, 1); shot.age = 9999; run.hits++; run.score += 100 }
    }
    run.shots = run.shots.filter(shot => shot.y > 0 && shot.age < 9999)
    if (run.targets.some(bug => bug.y >= 350)) {
      run.lives--; run.targets = []; run.shots = []; run.nextWave = run.tick + 800
      if (!run.lives) run.status = 'lost'
    }
    if (!run.targets.length && run.tick >= run.nextWave && run.status === 'running') wave(run)
  } else {
    if (run.nextTarget && run.tick >= run.nextTarget) { run.nextTarget = 0; target(run) }
    const shot = run.shots[0], bug = run.targets[0]
    if (shot && bug) {
      // Substeps prevent fast blades from tunnelling through small targets.
      for (let i = 0; i < 4 && run.shots.length; i++) {
        shot.x += shot.vx * .005; shot.y += shot.vy * .005; shot.vy += 300 * .005; shot.age += 5
        const radius = Math.max(9, 20 - run.hits * .6)
        if (Math.hypot((shot.x - bug.x) / 1.6, shot.y - bug.y) <= radius) {
          run.hits++; run.score += (4 - run.throws) * 100; run.shots = []; run.targets = []; run.nextTarget = run.tick + 500
        } else if (shot.x < 0 || shot.x > WIDTH || shot.y > HEIGHT || shot.age >= 4000) {
          run.marks.push({ id: run.throws, x: Math.max(8, Math.min(312, shot.x)), y: Math.max(12, Math.min(355, shot.y)) })
          run.shots = []; run.attempts--; if (!run.attempts) run.status = 'lost'
        }
      }
    }
  }
  if (run.tick >= MAX_TIME) run.status = 'lost'
}
export function advanceWeapon(run: WeaponRun, until: number) {
  while (run.status === 'running' && run.tick + STEP <= until) step(run)
}
export function replayWeapon(game: WeaponGame, seed: number, actions: Input[], elapsedMs: number) {
  const run = createWeaponRun(game, seed)
  for (const action of actions) {
    if (action.at < run.tick || action.at % STEP || action.at > elapsedMs) throw new Error('Ordre des actions invalide.')
    advanceWeapon(run, action.at)
    if (run.tick !== action.at || !weaponInput(run, action)) throw new Error('Action impossible pour cette partie.')
  }
  advanceWeapon(run, elapsedMs)
  if (run.status !== 'lost' || run.tick !== elapsedMs) throw new Error('La partie n’est pas terminée à cet instant.')
  return run
}

/** Coalesce pointer positions, preserving release/press edges that reset pressure. */
export function recordWeaponInput(run: WeaponRun, actions: Input[], value: Omit<Input, 'at'>) {
  if (value.fire !== undefined && value.fire === run.fire && value.x === undefined) return false
  const action = { ...value, at: run.tick }
  if (!weaponInput(run, action)) return false
  const last = actions.at(-1)
  if (run.game === 'digrain' && last?.at === action.at && action.fire === undefined) Object.assign(last, action)
  else actions.push(action)
  return true
}
