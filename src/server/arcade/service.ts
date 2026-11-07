import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import type { Client, Row } from '@libsql/client'
import { advanceRun, createRun, strike } from '../../game/sandale/engine'
import type { FinishedRun, ScoreReceipt } from '../../game/sandale/protocol'
import { GAME_SCHEMA_VERSION, migrateLocalDatabase } from '../db/local-migrations'
import { awardPodium, podiumAmount, PODIUM_CAP } from './rewards'
import { gameRules, rankingOrder, type ArcadeGame } from '../../game/weapons/catalog'
import { replayWeapon } from '../../game/weapons/engine'
import { databaseWrite } from '../db/write'
import { sessionStandings } from './standings'

export class ArcadeError extends Error {
  constructor(public code: 'BAD_REQUEST' | 'FORBIDDEN' | 'TOO_MANY_REQUESTS' | 'NOT_FOUND', message: string) { super(message) }
}
const hash = (token: string) => createHash('sha256').update(token).digest('hex')
const receipt = (row: Row): ScoreReceipt => ({ id: String(row.id), elapsedMs: Number(row.elapsed_ms), crushed: Number(row.crushed), claimed: Boolean(row.claimed_by), points: Number(row.points ?? 0) })

export async function createArcadeService(client: Client, now = () => Date.now(), options: { allowHosted?: boolean; game?: ArcadeGame } = {}) {
  if (client.protocol === 'file') await migrateLocalDatabase(client)
  else {
    if (!options.allowHosted) throw new Error('Le bootstrap arcade exige SQLite local ou une base hébergée préparée explicitement.')
    const ready = await client.execute({ sql: 'SELECT version FROM scolo_schema_migrations WHERE version=?', args: [GAME_SCHEMA_VERSION] })
    if (!ready.rows.length) throw new Error('La base arcade doit être migrée explicitement avant démarrage.')
  }


  const game = options.game ?? 'sandale'
  const rules = gameRules(game)
  const order = rankingOrder(game)

  async function find(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new ArcadeError('NOT_FOUND', 'Partie introuvable.')
    const row = (await client.execute({ sql: 'SELECT * FROM scolo_arcade_runs WHERE token_hash = ? AND rules = ?', args: [hash(token), rules] })).rows[0]
    if (!row) throw new ArcadeError('NOT_FOUND', 'Partie introuvable pour cette version du jeu.')
    return row
  }

  return {
    async start(userId: string | null, rateKey: string) {
      return databaseWrite(client, async tx => {
        const count = (await tx.execute({ sql: 'SELECT COUNT(*) AS n FROM scolo_arcade_runs WHERE rate_key = ? AND started_at > ?', args: [rateKey, now() - 60000] })).rows[0]!
        if (Number(count.n) >= 40) throw new ArcadeError('TOO_MANY_REQUESTS', 'Trop de parties lancées. Attends une minute.')
        const token = randomBytes(32).toString('hex')
        const seed = randomInt(1, 2147483647)
        const id = randomUUID()
        await tx.execute({ sql: 'INSERT INTO scolo_arcade_runs (id, token_hash, rules, seed, started_at, rate_key, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)', args: [id, hash(token), rules, seed, now(), rateKey, userId] })
        return { token, seed, rules }
      })
    },
    async finish(input: FinishedRun, userId: string | null) {
      const row = await find(input.token)
      if ((row.owner_id && row.owner_id !== userId) || (row.claimed_by && row.claimed_by !== userId)) throw new ArcadeError('FORBIDDEN', 'Cette partie appartient à un autre compte. Reconnecte ce compte pour la récupérer.')
      const payloadHash = hash(JSON.stringify({ elapsedMs: input.elapsedMs, actions: input.actions }))
      if (row.payload_hash) {
        if (row.payload_hash !== payloadHash) throw new ArcadeError('BAD_REQUEST', 'Cette partie a déjà un autre résultat.')
        return receipt(row)
      }
      if (input.elapsedMs > now() - Number(row.started_at) + 750) throw new ArcadeError('BAD_REQUEST', 'Le temps de cette partie ne correspond pas au départ enregistré.')
      let score: { elapsedMs: number; crushed: number; points: number }
      if (game === 'sandale') {
        const run = createRun(Number(row.seed))
        for (const action of input.actions) {
          if (action.at < run.elapsedMs || action.at > input.elapsedMs) throw new ArcadeError('BAD_REQUEST', 'Ordre des coups invalide.')
          advanceRun(run, action.at - run.elapsedMs)
          const result = strike(run, action.bugId)
          if (!result.accepted || (action.bugId !== undefined && !result.hit)) throw new ArcadeError('BAD_REQUEST', 'Un coup ne correspond pas à cette partie.')
        }
        advanceRun(run, input.elapsedMs - run.elapsedMs)
        if (run.status !== 'lost' || Math.abs(run.elapsedMs - input.elapsedMs) > 1) throw new ArcadeError('BAD_REQUEST', 'La partie n’est pas terminée à cet instant.')
        score = { elapsedMs: run.elapsedMs, crushed: run.crushed, points: 0 }
      } else {
        try {
          const run = replayWeapon(game, Number(row.seed), input.actions, input.elapsedMs)
          score = { elapsedMs: run.tick, crushed: run.hits, points: run.score }
        } catch { throw new ArcadeError('BAD_REQUEST', 'La partie ou ses actions sont invalides.') }
      }
      return databaseWrite(client, async tx => {
        await tx.execute({ sql: 'UPDATE scolo_arcade_runs SET elapsed_ms = ?, crushed = ?, points = ?, payload_hash = ? WHERE id = ? AND payload_hash IS NULL', args: [Math.round(score.elapsedMs), score.crushed, score.points, payloadHash, row.id!] })
        const saved = (await tx.execute({ sql: 'SELECT * FROM scolo_arcade_runs WHERE id=?', args: [row.id!] })).rows[0]!
        if (saved.payload_hash !== payloadHash) throw new ArcadeError('BAD_REQUEST', 'Cette partie a déjà un autre résultat.')
        return receipt(saved)
      })
    },
    async pending(token: string | undefined, userId: string | null) {
      if (!token) return null
      let row: Row
      try { row = await find(token) } catch (error) { if (error instanceof ArcadeError && error.code === 'NOT_FOUND') return null; throw error }
      if (!row.payload_hash || (row.claimed_by && row.claimed_by !== userId)) return null
      return { ...receipt(row), otherAccount: Boolean(row.owner_id && row.owner_id !== userId) }
    },
    async claim(token: string, userId: string, displayName: string) {
      const original = await find(token)
      return databaseWrite(client, async tx => {
        const row = (await tx.execute({ sql: 'SELECT * FROM scolo_arcade_runs WHERE id = ?', args: [original.id!] })).rows[0]!
        if (!row.payload_hash) throw new ArcadeError('BAD_REQUEST', 'Le score doit être sauvegardé avant la connexion.')
        if ((row.owner_id && row.owner_id !== userId) || (row.claimed_by && row.claimed_by !== userId)) throw new ArcadeError('FORBIDDEN', 'Ce score est associé à un autre compte.')
        if (!row.claimed_by) {
          const claimedAt = now()
          await tx.execute({ sql: 'UPDATE scolo_arcade_runs SET claimed_by = ?, claimed_at = ? WHERE id = ? AND claimed_by IS NULL', args: [userId, claimedAt, row.id!] })
          await tx.execute({ sql: `INSERT INTO scolo_arcade_bests (rules,user_id,display_name,elapsed_ms,crushed,claimed_at,run_id,points) VALUES (?,?,?,?,?,?,?,?)
            ON CONFLICT(rules,user_id) DO UPDATE SET display_name=excluded.display_name, elapsed_ms=excluded.elapsed_ms, crushed=excluded.crushed, claimed_at=excluded.claimed_at, run_id=excluded.run_id, points=excluded.points
            WHERE ${game === 'sandale' ? 'excluded.elapsed_ms > scolo_arcade_bests.elapsed_ms OR (excluded.elapsed_ms = scolo_arcade_bests.elapsed_ms AND excluded.crushed > scolo_arcade_bests.crushed)' : 'excluded.points > scolo_arcade_bests.points OR (excluded.points = scolo_arcade_bests.points AND excluded.elapsed_ms < scolo_arcade_bests.elapsed_ms)'}`,
          args: [rules, userId, displayName.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) || 'Joueur', row.elapsed_ms!, row.crushed!, claimedAt, row.id!, Number(row.points ?? 0)] })
        }
        const reward = await awardPodium(tx, userId, displayName, now(), game)
        return { ...receipt(row), claimed: true, reward }
      })
    },
    async leaderboard(userId: string | null) {
      const ranked = `WITH ranked AS (SELECT *, ROW_NUMBER() OVER (ORDER BY ${order}, claimed_at ASC, run_id ASC) AS rank FROM scolo_arcade_bests WHERE rules = ?)`
      const rows = (await client.execute({ sql: `${ranked} SELECT * FROM ranked ORDER BY rank LIMIT 20`, args: [rules] })).rows
      const me = userId ? (await client.execute({ sql: `${ranked} SELECT * FROM ranked WHERE user_id = ?`, args: [rules, userId] })).rows[0] : undefined
      const publicRow = (row: Row) => ({ rank: Number(row.rank), name: String(row.display_name), elapsedMs: Number(row.elapsed_ms), crushed: Number(row.crushed), isMe: row.user_id === userId, points: Number(row.points ?? 0) })
      const earned = userId ? (await client.execute({ sql: game === 'sandale' ? 'SELECT total FROM scolo_arcade_rewards WHERE user_id=?' : 'SELECT total FROM scolo_arcade_game_rewards WHERE user_id=? AND game=?', args: game === 'sandale' ? [userId] : [userId, game] })).rows[0] : undefined
      const total = Number(earned?.total ?? 0)
      return { entries: rows.map(publicRow), me: me ? publicRow(me) : null,
        reward: userId ? { total, available: Math.max(0, (me ? podiumAmount(Number(me.rank)) : 0) - total), cap: PODIUM_CAP } : null }
    },
    async standings(userId: string | null, token?: string, offset?: number) {
      let current: Row | null = null
      if (token) {
        try {
          const row = await find(token)
          if (row.payload_hash && (!row.owner_id || row.owner_id === userId) && (!row.claimed_by || row.claimed_by === userId)) current = row
        } catch (error) { if (!(error instanceof ArcadeError && error.code === 'NOT_FOUND')) throw error }
      }
      return sessionStandings(client, userId, current, offset, game)
    },
    async reward(userId: string, displayName: string) {
      return databaseWrite(client, tx => awardPodium(tx, userId, displayName, now(), game))
    },
  }
}
