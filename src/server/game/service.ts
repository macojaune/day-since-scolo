import { randomUUID } from 'node:crypto'
import type { Client, InArgs, Row, Transaction } from '@libsql/client'
import { GAME_SCHEMA_VERSION, migrateLocalDatabase } from '../db/local-migrations'
import { enqueueAppearanceTweet } from '../social/tweet-outbox'
import { enqueueParticipationTweet } from '../social/participation-tweets'
import { enqueuePointJobs } from '../zikak/jobs'
import { calculateReplayBonuses, calculateSettlement, gameDayStart, safeTotal, type SettlementTicket } from './settlement'
import { ensurePlayerInTransaction } from './player'
import {
  GameError,
  type Appearance,
  type ApplicationEnvironment,
  type HistoricalAppearanceInput,
  type WalletMode,
  type PlacePredictionInput,
  type PlayerGame,
  type PlayerInput,
  type Prediction,
  type PredictionStatus,
  type PublicGame,
  type SettlementInput,
  type SettlementResult,
} from './types'

interface ClockOptions { now?: () => Date; id?: () => string; walletMode?: WalletMode; environment?: ApplicationEnvironment; tweetEnabled?: boolean; zikakApplicationId?: string }
type Connection = Pick<Client, 'execute'> | Transaction
const queues = new WeakMap<Client, Promise<unknown>>()

function iso(value: unknown) { return new Date(Number(value)).toISOString() }
function inputDate(value: Date, label: string) {
  const instant = value instanceof Date ? value.getTime() : NaN
  if (!Number.isSafeInteger(instant)) throw new GameError('INVALID_INPUT', `${label} invalide.`)
  return instant
}
function textInput(value: string, label: string, maxLength = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new GameError('INVALID_INPUT', `${label} invalide.`)
  }
  return value
}
function prediction(row: Row): Prediction {
  return {
    id: String(row.id), roundId: String(row.round_id), predictedAt: iso(row.predicted_at),
    stake: Number(row.stake), createdAt: iso(row.created_at),
    status: String(row.status) as PredictionStatus, payout: Number(row.payout),
  }
}
async function query(connection: Connection, sql: string, args: InArgs = []): Promise<Row[]> {
  return (await connection.execute({ sql, args })).rows
}

/** Scolo-scoped wallet; authentication and administrator checks belong to the caller. */
export class GameService {
  private readonly clock: () => Date
  private readonly newId: () => string
  private readonly walletMode: WalletMode
  private readonly tweetEnabled: boolean
  private readonly zikakApplicationId?: string
  private readonly environment: ApplicationEnvironment

  constructor(private readonly client: Client, options: ClockOptions = {}) {
    this.clock = options.now ?? (() => new Date())
    this.newId = options.id ?? randomUUID
    this.walletMode = options.walletMode ?? 'local'
    this.environment = options.environment ?? (this.walletMode === 'local' ? 'local' : 'prod')
    this.tweetEnabled = this.environment === 'prod' && this.walletMode === 'scolo' && options.tweetEnabled === true
    const source = this.environment === 'prod' ? /^scolo-prod$/ : /^scolo-dev(?:-[a-z0-9-]+)?$/
    if (options.zikakApplicationId && !source.test(options.zikakApplicationId)) {
      throw new GameError('CONFIGURATION_ERROR', 'La source Zikak ne correspond pas à cet environnement Scolo.')
    }
    this.zikakApplicationId = options.zikakApplicationId
  }

  async initialize() {
    if (this.walletMode === 'local') await migrateLocalDatabase(this.client)
    else {
      const table = await this.client.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scolo_schema_migrations'")
      const version = table.rows.length
        ? await query(this.client, 'SELECT version FROM scolo_schema_migrations WHERE version = ?', [GAME_SCHEMA_VERSION])
        : []
      if (!version.length) throw new GameError('CONFIGURATION_ERROR', 'La migration du jeu doit être appliquée avant son ouverture.')
    }
    await this.write(async transaction => {
      if (this.zikakApplicationId) {
        const otherSource = await query(transaction, 'SELECT 1 FROM scolo_zikak_batches WHERE application_id <> ? UNION ALL SELECT 1 FROM scolo_zikak_jobs WHERE application_id <> ? LIMIT 1', [this.zikakApplicationId,this.zikakApplicationId])
        if (otherSource.length) throw new GameError('CONFIGURATION_ERROR', 'Cette base est déjà liée à une autre application Zikak DEV.')
      }
      const open = await query(transaction, "SELECT id FROM scolo_rounds WHERE status = 'open'")
      if (!open.length) {
        await transaction.execute({
          sql: "INSERT INTO scolo_rounds (id, opened_at, status) VALUES (?, ?, 'open')",
          args: [this.newId(), this.clock().getTime()],
        })
      }
    })
    return this
  }

  private async write<T>(operation: (transaction: Transaction) => Promise<T>): Promise<T> {
    const run = async () => {
      const transaction = await this.client.transaction('write')
      try {
        const result = await operation(transaction)
        await transaction.commit()
        return result
      } catch (error) {
        await transaction.rollback()
        throw error
      } finally {
        transaction.close()
      }
    }
    const pending = (queues.get(this.client) ?? Promise.resolve()).then(run, run)
    queues.set(this.client, pending.catch(() => undefined))
    return pending
  }

  private async read<T>(operation: (transaction: Transaction) => Promise<T>): Promise<T> {
    const transaction = await this.client.transaction('read')
    try { return await operation(transaction) } finally { transaction.close() }
  }

  private async ensurePlayerIn(transaction: Transaction, input: PlayerInput, now: number) {
    return ensurePlayerInTransaction(transaction, input, { now, id: this.newId })
  }

  private async ledger(transaction: Transaction, playerId: string, amount: number, kind: string, reference: string, now: number) {
    await transaction.execute({
      sql: 'INSERT INTO scolo_wallet_entries (id, player_id, amount, kind, reference, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [this.newId(), playerId, amount, kind, reference, now],
    })
  }

  async ensurePlayer(input: PlayerInput) {
    return this.write(async transaction => {
      textInput(input.userId, 'Identité')
      const existing = await query(transaction, 'SELECT id FROM scolo_players WHERE clerk_user_id = ?', [input.userId])
      const player = await this.ensurePlayerIn(transaction, input, this.clock().getTime())
      const wallet = (await query(transaction, 'SELECT balance FROM scolo_wallets WHERE player_id = ?', [String(player.id)]))[0]!
      return { id: String(player.id), displayName: String(player.display_name), balance: Number(wallet.balance), created: existing.length === 0 }
    })
  }

  async getPublicGame(): Promise<PublicGame> {
    return this.read(async transaction => {
      const round = (await query(transaction, "SELECT * FROM scolo_rounds WHERE status = 'open'"))[0]
      if (!round) throw new GameError('ROUND_CLOSED', 'Aucune manche ouverte.')
      const tickets = await query(transaction, "SELECT * FROM scolo_predictions WHERE round_id = ? AND status = 'active' ORDER BY predicted_at, created_at, id", [String(round.id)])
      const pot = safeTotal(tickets.map(ticket => Number(ticket.stake)))
      const grouped = new Map<number, { totalStake: number; predictionCount: number; participants: Set<string> }>()
      for (const ticket of tickets) {
        // Older local fixtures retain their recorded timestamps; only the
        // public grouping changes to the day-only rule.
        const key = gameDayStart(Number(ticket.predicted_at))
        const group = grouped.get(key) ?? { totalStake: 0, predictionCount: 0, participants: new Set<string>() }
        group.totalStake = safeTotal([group.totalStake, Number(ticket.stake)])
        group.predictionCount++
        group.participants.add(String(ticket.player_id))
        grouped.set(key, group)
      }
      const history: Appearance[] = (await query(transaction, 'SELECT * FROM "scolo-data" WHERE created_at IS NOT NULL ORDER BY created_at DESC, id DESC'))
        .map(row => ({ id: Number(row.id), occurredAt: iso(Number(row.created_at) * 1000), tool: String(row.tool ?? 'inconnu') }))
      const settlement = (await query(transaction, 'SELECT * FROM scolo_settlements ORDER BY declared_at DESC, round_id DESC LIMIT 1'))[0]
      return {
        environment: this.environment, walletMode: this.walletMode, isSimulated: this.environment !== 'prod',
        round: {
          id: String(round.id), openedAt: iso(round.opened_at), pot,
          predictionCount: tickets.length,
          participantCount: new Set(tickets.map(ticket => String(ticket.player_id))).size,
          groups: [...grouped].map(([instant, group]) => ({
            predictedAt: iso(instant), totalStake: group.totalStake,
            predictionCount: group.predictionCount, participantCount: group.participants.size,
            odds: pot / group.totalStake,
          })),
        },
        lastAppearance: history[0] ?? null, history,
        recentResult: settlement ? await this.storedSettlement(transaction, settlement) : null,
      }
    })
  }

  async getPlayerGame(userId: string): Promise<PlayerGame> {
    textInput(userId, 'Identité')
    return this.read(async transaction => {
      const player = (await query(transaction, 'SELECT p.id, w.balance FROM scolo_players p JOIN scolo_wallets w ON w.player_id = p.id WHERE p.clerk_user_id = ?', [userId]))[0]
      if (!player) throw new GameError('PLAYER_NOT_FOUND', 'Le portefeuille doit être initialisé après connexion.')
      const rows = await query(transaction, 'SELECT * FROM scolo_predictions WHERE player_id = ? ORDER BY created_at DESC, id DESC', [String(player.id)])
      return {
        balance: Number(player.balance),
        committed: safeTotal(rows.filter(row => row.status === 'active').map(row => Number(row.stake))),
        predictions: rows.map(prediction),
      }
    })
  }

  async placePrediction(input: PlacePredictionInput) {
    textInput(input.userId, 'Identité')
    textInput(input.roundId, 'Manche')
    textInput(input.idempotencyKey, 'Clé de confirmation', 128)
    const predictedAt = gameDayStart(inputDate(input.predictedAt, 'Date du pronostic'))
    if (!Number.isSafeInteger(input.stake) || input.stake < 1) throw new GameError('INVALID_INPUT', 'La mise doit être un nombre entier de Zikak supérieur ou égal à 1.')
    return this.write(async transaction => {
      const now = this.clock().getTime()
      const player = await this.ensurePlayerIn(transaction, input, now)
      const playerId = String(player.id)
      const existing = (await query(transaction, 'SELECT * FROM scolo_predictions WHERE player_id = ? AND round_id = ? AND idempotency_key = ?', [playerId, input.roundId, input.idempotencyKey]))[0]
      if (existing) {
        if (gameDayStart(Number(existing.predicted_at)) !== predictedAt || Number(existing.stake) !== input.stake) {
          throw new GameError('IDEMPOTENCY_CONFLICT', 'Cette confirmation a déjà été utilisée pour un autre pronostic.')
        }
        const wallet = (await query(transaction, 'SELECT balance FROM scolo_wallets WHERE player_id = ?', [playerId]))[0]!
        return { prediction: prediction(existing), balance: Number(wallet.balance) }
      }
      const round = (await query(transaction, 'SELECT * FROM scolo_rounds WHERE id = ?', [input.roundId]))[0]
      if (!round || round.status !== 'open') throw new GameError('ROUND_CLOSED', 'Cette manche est terminée. Actualise la page pour jouer la suivante.')
      if (predictedAt < gameDayStart(now)) throw new GameError('INVALID_INPUT', 'Choisis aujourd’hui ou une date à venir.')
      const stakes = await query(transaction, "SELECT stake FROM scolo_predictions WHERE round_id = ? AND status = 'active'", [input.roundId])
      safeTotal([...stakes.map(row => Number(row.stake)), input.stake])
      const debited = await query(transaction, 'UPDATE scolo_wallets SET balance = balance - ? WHERE player_id = ? AND balance >= ? RETURNING balance', [input.stake, playerId, input.stake])
      if (!debited.length) throw new GameError('INSUFFICIENT_BALANCE', 'Tu n’as pas assez de Zikak disponibles pour cette mise.')
      const id = this.newId()
      const inserted = (await query(transaction,
        "INSERT INTO scolo_predictions (id, player_id, round_id, predicted_at, stake, created_at, idempotency_key, status, payout) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 0) RETURNING *",
        [id, playerId, input.roundId, predictedAt, input.stake, now, input.idempotencyKey]))[0]!
      await this.ledger(transaction, playerId, -input.stake, 'reserve', `prediction:${id}`, now)
      await enqueueParticipationTweet(transaction, input.roundId, now, this.tweetEnabled, playerId)
      return { prediction: prediction(inserted), balance: Number(debited[0]!.balance) }
    })
  }

  async addHistoricalAppearance(input: HistoricalAppearanceInput): Promise<Appearance> {
    const observedAt = this.validateObservation(input.observedAt, input.tool)
    textInput(input.idempotencyKey, 'Clé de confirmation', 128)
    textInput(input.actorUserId, 'Administrateur')
    return this.write(async transaction => {
      const existing = (await query(transaction, 'SELECT * FROM scolo_history_additions WHERE idempotency_key = ?', [input.idempotencyKey]))[0]
      if (existing) {
        if (Number(existing.observed_at) !== observedAt || existing.tool !== input.tool || existing.actor_clerk_user_id !== input.actorUserId) {
          throw new GameError('IDEMPOTENCY_CONFLICT', 'Cette confirmation a déjà servi pour une autre apparition.')
        }
        return { id: Number(existing.appearance_id), occurredAt: iso(Math.floor(observedAt / 1000) * 1000), tool: input.tool }
      }
      const round = (await query(transaction, "SELECT opened_at FROM scolo_rounds WHERE status = 'open'"))[0]
      if (!round) throw new GameError('ROUND_CLOSED', 'Aucune manche ouverte. Actualise la page avant de continuer.')
      if (observedAt > Number(round.opened_at)) {
        throw new GameError('INVALID_INPUT', 'Cette apparition concerne la manche en cours. Utilise « Déclarer et régler la manche » pour répartir la cagnotte.')
      }
      const seconds = Math.floor(observedAt / 1000)
      const duplicate = await query(transaction, 'SELECT id FROM "scolo-data" WHERE created_at = ? LIMIT 1', [seconds])
      if (duplicate.length) throw new GameError('INVALID_INPUT', 'Une apparition est déjà enregistrée à cette date et cette heure.')
      const appearance = (await query(transaction, 'INSERT INTO "scolo-data" (created_at, tool) VALUES (?, ?) RETURNING id', [seconds, input.tool]))[0]!
      await transaction.execute({
        sql: 'INSERT INTO scolo_history_additions (idempotency_key, observed_at, tool, appearance_id, actor_clerk_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [input.idempotencyKey, observedAt, input.tool, Number(appearance.id), input.actorUserId, this.clock().getTime()],
      })
      return { id: Number(appearance.id), occurredAt: iso(seconds * 1000), tool: input.tool }
    })
  }

  private async tickets(transaction: Transaction, roundId: string): Promise<SettlementTicket[]> {
    return (await query(transaction, 'SELECT b.*, p.display_name FROM scolo_predictions b JOIN scolo_players p ON p.id = b.player_id WHERE b.round_id = ? ORDER BY b.created_at, b.id', [roundId]))
      .map(row => ({ id: String(row.id), playerId: String(row.player_id), playerName: String(row.display_name), predictedAt: Number(row.predicted_at), createdAt: Number(row.created_at), stake: Number(row.stake) }))
  }

  private async balances(transaction: Transaction, roundId: string) {
    return new Map((await query(transaction, 'SELECT DISTINCT w.player_id, w.balance FROM scolo_wallets w JOIN scolo_predictions b ON b.player_id = w.player_id WHERE b.round_id = ?', [roundId]))
      .map(row => [String(row.player_id), Number(row.balance)] as const))
  }

  private validateObservation(date: Date, tool: string) {
    const observedAt = inputDate(date, 'Date de l’apparition')
    if (!['digrain', 'sandale', 'coutelas', 'capes'].includes(tool)) throw new GameError('INVALID_INPUT', 'Choisis une arme disponible.')
    if (observedAt > this.clock().getTime()) throw new GameError('INVALID_INPUT', 'L’apparition ne peut pas être dans le futur.')
    return observedAt
  }

  private validateSettlement(input: SettlementInput) {
    textInput(input.roundId, 'Manche')
    return this.validateObservation(input.observedAt, input.tool)
  }

  private async previewIn(transaction: Transaction, input: SettlementInput): Promise<SettlementResult> {
    const observedAt = this.validateSettlement(input)
    const existing = (await query(transaction, 'SELECT * FROM scolo_settlements WHERE round_id = ?', [input.roundId]))[0]
    if (existing) {
      if (Number(existing.observed_at) !== observedAt || existing.tool !== input.tool) {
        throw new GameError('IDEMPOTENCY_CONFLICT', 'Cette manche a déjà été réglée avec une autre apparition.')
      }
      return this.storedSettlement(transaction, existing)
    }
    const round = (await query(transaction, 'SELECT * FROM scolo_rounds WHERE id = ?', [input.roundId]))[0]
    if (!round || round.status !== 'open') throw new GameError('ROUND_CLOSED', 'Cette manche est déjà terminée.')
    if (observedAt <= Number(round.opened_at)) throw new GameError('INVALID_INPUT', 'L’apparition doit être postérieure à l’ouverture de cette manche.')
    return { roundId: input.roundId, observedAt: iso(observedAt), tool: input.tool, ...calculateSettlement(await this.tickets(transaction, input.roundId), observedAt, await this.balances(transaction, input.roundId)) }
  }

  async previewSettlement(input: SettlementInput): Promise<SettlementResult> {
    return this.read(transaction => this.previewIn(transaction, input))
  }

  async settleRound(input: SettlementInput): Promise<SettlementResult> {
    return this.write(async transaction => {
      const result = await this.previewIn(transaction, input)
      if (result.nextRoundId) return result
      const now = this.clock().getTime()
      const tickets = await this.tickets(transaction, input.roundId)
      const byId = new Map(tickets.map(ticket => [ticket.id, ticket]))
      const replayBonuses = calculateReplayBonuses(tickets, result.entries, await this.balances(transaction, input.roundId))
      for (const entry of result.entries) {
        const ticket = byId.get(entry.predictionId)!
        await transaction.execute({ sql: 'UPDATE scolo_predictions SET status = ?, payout = ? WHERE id = ? AND status = ?', args: [entry.outcome, entry.payout, ticket.id, 'active'] })
        if (entry.payout > 0) {
          const wallet = (await query(transaction, 'SELECT balance FROM scolo_wallets WHERE player_id = ?', [ticket.playerId]))[0]!
          safeTotal([Number(wallet.balance), entry.payout])
          await transaction.execute({ sql: 'UPDATE scolo_wallets SET balance = balance + ? WHERE player_id = ?', args: [entry.payout, ticket.playerId] })
          await this.ledger(transaction, ticket.playerId, entry.payout, entry.outcome === 'refunded' ? 'refund' : 'payout', `settlement:${input.roundId}:${ticket.id}`, now)
        }
      }
      for (const bonus of replayBonuses) {
        const wallet = (await query(transaction, 'SELECT balance FROM scolo_wallets WHERE player_id = ?', [bonus.playerId]))[0]!
        safeTotal([Number(wallet.balance), bonus.amount])
        await transaction.execute({ sql: 'UPDATE scolo_wallets SET balance = balance + ? WHERE player_id = ?', args: [bonus.amount, bonus.playerId] })
        await this.ledger(transaction, bonus.playerId, bonus.amount, 'round_bonus', `round-bonus:${input.roundId}:${bonus.playerId}`, now)
      }
      await transaction.execute({ sql: "UPDATE scolo_rounds SET status = 'settled', closed_at = ? WHERE id = ? AND status = 'open'", args: [now, input.roundId] })
      const nextRoundId = this.newId()
      await transaction.execute({ sql: "INSERT INTO scolo_rounds (id, opened_at, status) VALUES (?, ?, 'open')", args: [nextRoundId, now] })
      const previousAppearance = (await query(transaction, 'SELECT MAX(created_at) AS occurred_at FROM "scolo-data" WHERE created_at <= ?', [Math.floor(input.observedAt.getTime() / 1000)]))[0]!
      const appearance = (await query(transaction, 'INSERT INTO "scolo-data" (created_at, tool) VALUES (?, ?) RETURNING id', [Math.floor(input.observedAt.getTime() / 1000), input.tool]))[0]!
      await transaction.execute({
        sql: 'INSERT INTO scolo_settlements (round_id, observed_at, tool, declared_at, pot, total_refunded, winning_distance_ms, next_round_id, appearance_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        args: [input.roundId, input.observedAt.getTime(), input.tool, now, result.pot, result.totalRefunded, result.winningDistanceMs, nextRoundId, Number(appearance.id)],
      })
      const winners = new Map<string, { name: string; amount: number }>()
      for (const entry of result.entries.filter(entry => entry.outcome === 'won')) {
        const ticket = byId.get(entry.predictionId)!
        const winner = winners.get(ticket.playerId) ?? { name: ticket.playerName, amount: 0 }
        winner.amount = safeTotal([winner.amount, entry.payout])
        winners.set(ticket.playerId, winner)
      }
      await enqueueAppearanceTweet(transaction, {
        appearanceId: Number(appearance.id), observedAt: input.observedAt, tool: input.tool, createdAt: now,
        previousAppearanceAt: previousAppearance.occurred_at === null ? null : Number(previousAppearance.occurred_at) * 1000,
        winners: [...winners.values()], totalRefunded: result.totalRefunded,
      }, this.tweetEnabled)
      await transaction.execute({ sql: "UPDATE scolo_participation_tweets SET status='skipped',error_code='ROUND_CLOSED' WHERE round_id=? AND status='pending'", args: [input.roundId] })
      if (this.zikakApplicationId) await enqueuePointJobs(transaction, {
        roundId: input.roundId, applicationId: this.zikakApplicationId, now, id: this.newId,
      })
      return { ...result, nextRoundId, appearanceId: Number(appearance.id) }
    })
  }

  private async storedSettlement(transaction: Transaction, row: Row): Promise<SettlementResult> {
    const entries = (await query(transaction, 'SELECT b.*, p.display_name FROM scolo_predictions b JOIN scolo_players p ON p.id = b.player_id WHERE b.round_id = ? ORDER BY b.created_at, b.id', [String(row.round_id)]))
      .map(ticket => ({ predictionId: String(ticket.id), playerName: String(ticket.display_name), predictedAt: iso(ticket.predicted_at), stake: Number(ticket.stake), outcome: String(ticket.status) as 'won' | 'lost' | 'refunded', payout: Number(ticket.payout) }))
    // Read the actual credits, not today's rule: historical rounds stay unchanged.
    const replayBonuses = (await query(transaction, "SELECT p.display_name, e.amount FROM scolo_wallet_entries e JOIN scolo_players p ON p.id = e.player_id WHERE e.kind = 'round_bonus' AND e.reference = 'round-bonus:' || ? || ':' || p.id ORDER BY p.id", [String(row.round_id)]))
      .map(bonus => ({ playerName: String(bonus.display_name), amount: Number(bonus.amount) }))
    return { roundId: String(row.round_id), appearanceId: Number(row.appearance_id), observedAt: iso(row.observed_at), tool: String(row.tool), pot: Number(row.pot), totalRefunded: Number(row.total_refunded), winningDistanceMs: row.winning_distance_ms === null ? null : Number(row.winning_distance_ms), nextRoundId: String(row.next_round_id), entries, replayBonuses, totalReplayBonus: safeTotal(replayBonuses.map(bonus => bonus.amount)) }
  }
}

export async function createGameService(client: Client, options: ClockOptions = {}) {
  return new GameService(client, options).initialize()
}
