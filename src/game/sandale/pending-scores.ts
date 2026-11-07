import type { ArcadeGame } from '../weapons/catalog'
import { finishInput, type FinishedRun } from './protocol'

export const SCORE_QUEUE_EVENT = 'scolo:sandale-score-queue'
export const AUTH_RETURN_KEY = 'scolo:sandale-auth-return:v3'
const KEY = 'scolo:sandale-pending:v3'
export type PendingScore = { token: string; id?: string; submission?: FinishedRun }
const fallbacks = new Map<ArcadeGame, PendingScore[]>()
const storageKey = (game: ArcadeGame) => game === 'sandale' ? KEY : `scolo:${game}:pending:v1`

export function pendingScores(game: ArcadeGame = 'sandale'): PendingScore[] {
  let stored: PendingScore[] = []
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(game)) ?? '[]')
    if (Array.isArray(parsed)) stored = parsed.flatMap((value: unknown) => {
      if (!value || typeof value !== 'object' || !('token' in value) || typeof value.token !== 'string' || !/^[a-f0-9]{64}$/.test(value.token)) return []
      const item = value as PendingScore
      if (item.submission && !finishInput.safeParse(item.submission).success) return []
      return [item]
    })
  } catch { /* The in-memory queue still works if storage is blocked. */ }
  return [...new Map([...stored, ...(fallbacks.get(game) ?? [])].map(item => [item.token, item])).values()]
}
function write(items: PendingScore[], game: ArcadeGame) {
  fallbacks.set(game, items)
  let durable = false
  try { localStorage.setItem(storageKey(game), JSON.stringify(items)); fallbacks.delete(game); durable = true } catch { /* Keep the live tab's copy until the server receipt is durable. */ }
  window.dispatchEvent(new Event(SCORE_QUEUE_EVENT))
  return durable
}
export function queueScore(submission: FinishedRun, game: ArcadeGame = 'sandale') {
  return write([...pendingScores(game).filter(item => item.token !== submission.token), { token: submission.token, submission }], game)
}
export function markScoreDurable(token: string, id: string, game: ArcadeGame = 'sandale') {
  return write(pendingScores(game).map(item => item.token === token ? { token, id } : item), game)
}
export function acknowledgeScore(id: string, game: ArcadeGame = 'sandale') {
  const items = pendingScores(game)
  if (items.some(item => item.id === id)) write(items.filter(item => item.id !== id), game)
}
const SEEN_KEY = 'scolo:sandale-seen:v3'
export function hasSeenScore(id: string) {
  try { return (JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]).includes(id) } catch { return false }
}
export function markScoreSeen(id: string) {
  try { const ids: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]'); localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...(Array.isArray(ids) ? ids.filter(x => typeof x === 'string') : []), id])].slice(-100))) } catch { /* A blocked store can show the durable receipt again; it cannot lose it. */ }
}
