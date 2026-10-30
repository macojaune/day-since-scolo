import type { Client, Row } from '@libsql/client'
import { SCORE_RULESET } from '../../game/sandale/engine'

/** The latest run temporarily replaces this account's best in its PRIVATE result view. */
export async function sessionStandings(client: Client, userId: string | null, current: Row | null, offset?: number) {
  const identity = userId ?? '__anonymous_current_run__'
  const own = userId ? (await client.execute({ sql: 'SELECT * FROM scolo_arcade_bests WHERE rules=? AND user_id=?', args: [SCORE_RULESET, userId] })).rows[0] : undefined
  const args = [SCORE_RULESET, current ? identity : '', identity, own ? String(own.display_name) : 'Toi', Number(current?.elapsed_ms ?? 0), Number(current?.crushed ?? 0), Number(current?.claimed_at ?? Date.now()), String(current?.id ?? ''), current ? 1 : 0]
  const ranked = `WITH candidates AS (
    SELECT user_id,display_name,elapsed_ms,crushed,claimed_at,run_id FROM scolo_arcade_bests WHERE rules=? AND user_id<>?
    UNION ALL SELECT ?,?,?,?,?,? WHERE ?=1
  ), ranked AS (SELECT *,ROW_NUMBER() OVER (ORDER BY elapsed_ms DESC,crushed DESC,claimed_at ASC,run_id ASC) AS rank FROM candidates)`
  const me = (await client.execute({ sql: `${ranked} SELECT * FROM ranked WHERE user_id=?`, args: [...args, identity] })).rows[0]
  const count = Number((await client.execute({ sql: `${ranked} SELECT COUNT(*) AS n FROM ranked`, args })).rows[0]!.n)
  const start = Math.min(Math.max(0, offset ?? Math.max(0, Number(me?.rank ?? 1) - 10)), Math.max(0, count - 1))
  const rows = (await client.execute({ sql: `${ranked} SELECT * FROM ranked WHERE rank>? AND rank<=? ORDER BY rank`, args: [...args, start, start + 20] })).rows
  const publicRow = (row: Row) => ({ rank: Number(row.rank), name: String(row.display_name), elapsedMs: Number(row.elapsed_ms), crushed: Number(row.crushed), isMe: row.user_id === identity })
  return { entries: rows.map(publicRow), me: me ? publicRow(me) : null, total: count, offset: start,
    previousOffset: start > 0 ? Math.max(0, start - 20) : null, nextOffset: start + 20 < count ? start + 20 : null,
    sessionId: current ? String(current.id) : null }
}
