import { randomUUID } from 'node:crypto'
import type { Transaction } from '@libsql/client'
import { ensurePlayerInTransaction } from '../game/player'
import { SCORE_RULESET } from '../../game/sandale/engine'

export const PODIUM_CAP = 3
export const podiumAmount = (rank: number) => rank >= 1 && rank <= 3 ? 4 - rank : 0

/** One lifetime cap for this game, independent of ruleset, rank loss, retries or seasons. */
export async function awardPodium(tx: Transaction, userId: string, displayName: string, now: number) {
  const position = (await tx.execute({
    sql: `WITH ranked AS (SELECT user_id,ROW_NUMBER() OVER (ORDER BY elapsed_ms DESC,crushed DESC,claimed_at ASC,run_id ASC) AS rank FROM scolo_arcade_bests WHERE rules=?) SELECT rank FROM ranked WHERE user_id=?`,
    args: [SCORE_RULESET, userId],
  })).rows[0]
  const rank = position ? Number(position.rank) : null
  const earned = (await tx.execute({ sql: 'SELECT total FROM scolo_arcade_rewards WHERE user_id=?', args: [userId] })).rows[0]
  const previous = Number(earned?.total ?? 0)
  const target = rank === null ? 0 : podiumAmount(rank)
  const delta = Math.max(0, target - previous)
  if (!delta) return { credited: 0, total: previous, rank, cap: PODIUM_CAP }
  const player = await ensurePlayerInTransaction(tx, { userId, displayName }, { now })
  const reference = `arcade:sandale:podium:${String(player.id)}:${target}`
  await tx.execute({ sql: "INSERT INTO scolo_wallet_entries (id,player_id,amount,kind,reference,created_at) VALUES (?,?,?,'arcade_bonus',?,?)", args: [randomUUID(), player.id!, delta, reference, now] })
  const updated = await tx.execute({ sql: 'UPDATE scolo_wallets SET balance=balance+? WHERE player_id=? AND balance<=? RETURNING balance', args: [delta, player.id!, Number.MAX_SAFE_INTEGER - delta] })
  if (!updated.rows.length) throw new Error('Arcade reward wallet invariant')
  await tx.execute({ sql: `INSERT INTO scolo_arcade_rewards (user_id,player_id,total,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET total=excluded.total,updated_at=excluded.updated_at`, args: [userId, player.id!, target, now] })
  return { credited: delta, total: target, rank, cap: PODIUM_CAP }
}
