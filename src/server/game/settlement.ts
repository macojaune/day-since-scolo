import { GameError, type SettlementEntry } from './types'

export interface SettlementTicket {
  id: string
  playerId: string
  playerName: string
  predictedAt: number
  createdAt: number
  stake: number
}

const DAY_MS = 86_400_000
const GUADELOUPE_MIDNIGHT_UTC_OFFSET_MS = 4 * 3_600_000

/** Game dates use Guadeloupe's fixed UTC−4 day, independently of the host timezone. */
export function gameDayStart(instant: number): number {
  return Math.floor((instant - GUADELOUPE_MIDNIGHT_UTC_OFFSET_MS) / DAY_MS) * DAY_MS + GUADELOUPE_MIDNIGHT_UTC_OFFSET_MS
}

export function safeTotal(values: number[]): number {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n)
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new GameError('INVALID_INPUT', 'Le montant dépasse la précision entière prise en charge.')
  }
  return Number(total)
}

/** Once per losing player whose balance after refunds and payouts is exactly zero. */
export function calculateReplayBonuses(tickets: SettlementTicket[], entries: SettlementEntry[], balances: ReadonlyMap<string, number>) {
  const byId = new Map(tickets.map(ticket => [ticket.id, ticket]))
  const winners = new Set(entries.filter(entry => entry.outcome === 'won').map(entry => byId.get(entry.predictionId)!.playerId))
  const losers = new Map<string, SettlementTicket>()
  const credits = new Map<string, number[]>()
  for (const entry of entries) {
    const ticket = byId.get(entry.predictionId)!
    if (entry.outcome === 'lost' && !winners.has(ticket.playerId)) losers.set(ticket.playerId, ticket)
    if (entry.payout > 0) credits.set(ticket.playerId, [...(credits.get(ticket.playerId) ?? []), entry.payout])
  }
  return [...losers.values()]
    .filter(ticket => {
      const balance = balances.get(ticket.playerId)
      return balance !== undefined && safeTotal([balance, ...(credits.get(ticket.playerId) ?? [])]) === 0
    })
    .sort((a, b) => a.playerId.localeCompare(b.playerId))
    .map(ticket => ({ playerId: ticket.playerId, playerName: ticket.playerName, amount: 2 }))
}

/** Score civil days. The exact observation instant still determines late-ticket refunds. */
export function calculateSettlement(tickets: SettlementTicket[], observedAt: number, balances: ReadonlyMap<string, number> = new Map()) {
  const eligible = tickets.filter(ticket => ticket.createdAt < observedAt)
  const refunds = tickets.filter(ticket => ticket.createdAt >= observedAt)
  const pot = safeTotal(eligible.map(ticket => ticket.stake))
  const totalRefunded = safeTotal(refunds.map(ticket => ticket.stake))
  const observedDay = gameDayStart(observedAt)
  const distance = (ticket: SettlementTicket) => Math.abs(gameDayStart(ticket.predictedAt) - observedDay)
  const winningDistanceMs = eligible.length
    ? eligible.reduce((closest, ticket) => Math.min(closest, distance(ticket)), Infinity)
    : null
  const winners = eligible.filter(ticket => distance(ticket) === winningDistanceMs)
  const winningStake = safeTotal(winners.map(ticket => ticket.stake))
  const payouts = new Map<string, number>()

  if (winningStake > 0) {
    const denominator = BigInt(winningStake)
    const parts = winners.map(ticket => {
      const numerator = BigInt(pot) * BigInt(ticket.stake)
      return { ticket, amount: Number(numerator / denominator), remainder: numerator % denominator }
    })
    let remaining = pot - safeTotal(parts.map(part => part.amount))
    parts.sort((a, b) => a.remainder !== b.remainder
      ? (a.remainder > b.remainder ? -1 : 1)
      : a.ticket.createdAt - b.ticket.createdAt || a.ticket.id.localeCompare(b.ticket.id))
    for (const part of parts) {
      payouts.set(part.ticket.id, part.amount + (remaining-- > 0 ? 1 : 0))
    }
  }

  const entries: SettlementEntry[] = tickets.map(ticket => {
    const refunded = ticket.createdAt >= observedAt
    const won = payouts.has(ticket.id)
    return {
      predictionId: ticket.id,
      playerName: ticket.playerName,
      predictedAt: new Date(ticket.predictedAt).toISOString(),
      stake: ticket.stake,
      outcome: refunded ? 'refunded' : won ? 'won' : 'lost',
      payout: refunded ? ticket.stake : (payouts.get(ticket.id) ?? 0),
    }
  })
  const replayBonuses = calculateReplayBonuses(tickets, entries, balances).map(({ playerName, amount }) => ({ playerName, amount }))
  return { pot, totalRefunded, winningDistanceMs, entries, replayBonuses, totalReplayBonus: safeTotal(replayBonuses.map(bonus => bonus.amount)) }
}
