import { z } from 'zod'
import { SCORE_RULESET, formatDuration } from '../sandale/engine'
export const gameInput = z.enum(['sandale', 'digrain', 'coutelas'])
export type ArcadeGame = z.infer<typeof gameInput>
export const gameRules = (game: ArcadeGame) => game === 'sandale' ? SCORE_RULESET : `${game}-v1`
export const gameLabel = (game: ArcadeGame) => ({ sandale: 'la sandale', digrain: 'Digrain', coutelas: 'le coutelas' })[game]
export const gameScore = (game: ArcadeGame, score: { elapsedMs: number; crushed?: number; points?: number }) => game === 'sandale' ? formatDuration(score.elapsedMs) : game === 'digrain' ? `${score.points === undefined ? score.crushed ?? 0 : Math.round(score.points / 100)} scolos` : `${score.points ?? 0} pts`

export const rankingOrder = (game: ArcadeGame) => game === 'sandale' ? 'elapsed_ms DESC, crushed DESC' : 'points DESC, elapsed_ms ASC'
