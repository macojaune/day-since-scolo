export type WalletMode = 'local' | 'scolo'
export type PredictionStatus = 'active' | 'won' | 'lost' | 'refunded'
export type GameErrorCode = 'INVALID_INPUT' | 'INSUFFICIENT_BALANCE' | 'ROUND_CLOSED' | 'IDEMPOTENCY_CONFLICT' | 'PLAYER_NOT_FOUND' | 'CONFIGURATION_ERROR'

export class GameError extends Error {
  constructor(public readonly code: GameErrorCode, message: string) {
    super(message)
    this.name = 'GameError'
  }
}

export interface PlayerInput { userId: string; displayName?: string }
export interface PlacePredictionInput extends PlayerInput {
  roundId: string
  /** The civil date in America/Guadeloupe; the service normalizes its time to midnight. */
  predictedAt: Date
  stake: number
  idempotencyKey: string
}
export interface SettlementInput { roundId: string; observedAt: Date; tool: string }
export interface HistoricalAppearanceInput { observedAt: Date; tool: string; idempotencyKey: string; actorUserId: string }
export interface Prediction {
  id: string
  roundId: string
  predictedAt: string
  stake: number
  createdAt: string
  status: PredictionStatus
  payout: number
}
export interface PredictionGroup {
  /** Midnight in Guadeloupe for the complete day's aggregate. */
  predictedAt: string
  totalStake: number
  predictionCount: number
  participantCount: number
  odds: number
}
export interface Appearance {
  id: number
  occurredAt: string
  tool: string
}
export interface SettlementEntry {
  predictionId: string
  playerName: string
  predictedAt: string
  stake: number
  outcome: 'won' | 'lost' | 'refunded'
  payout: number
}
export interface ReplayBonus {
  playerName: string
  amount: number
}
export interface SettlementResult {
  roundId: string
  observedAt: string
  tool: string
  pot: number
  totalRefunded: number
  /** Extra points for losing participants with zero balance after refunds/payouts; separate from the pot. */
  totalReplayBonus: number
  replayBonuses: ReplayBonus[]
  /** Whole civil-day distance encoded as milliseconds. Stored historical settlements are preserved. */
  winningDistanceMs: number | null
  entries: SettlementEntry[]
  nextRoundId?: string
  /** Present after settlement; previews have not created an appearance yet. */
  appearanceId?: number
}
export interface PublicGame {
  walletMode: WalletMode
  isSimulated: boolean
  round: {
    id: string
    openedAt: string
    pot: number
    predictionCount: number
    participantCount: number
    groups: PredictionGroup[]
  }
  lastAppearance: Appearance | null
  history: Appearance[]
  recentResult: SettlementResult | null
}
export interface PlayerGame {
  balance: number
  committed: number
  predictions: Prediction[]
}
