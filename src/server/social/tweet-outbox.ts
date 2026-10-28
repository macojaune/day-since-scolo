import type { Client } from '@libsql/client'
import { TweetPublicationError } from './twitter'

type Connection = Pick<Client, 'execute'>
export type TweetStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'unknown'
export interface TweetAppearance { appearanceId: number; observedAt: Date; tool: string; createdAt: number }

/** Additive schema; creation belongs to the application's explicit database migration. */
export const tweetOutboxSchema = `CREATE TABLE IF NOT EXISTS scolo_tweet_outbox (
  appearance_id INTEGER PRIMARY KEY NOT NULL REFERENCES "scolo-data"(id),
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'unknown')),
  created_at INTEGER NOT NULL,
  attempted_at INTEGER,
  published_at INTEGER,
  tweet_id TEXT UNIQUE,
  error_code TEXT
)`

export function buildAppearanceTweet(input: Pick<TweetAppearance, 'observedAt' | 'tool'>): string {
  if (!(input.observedAt instanceof Date) || !Number.isFinite(input.observedAt.getTime())) throw new Error('Invalid appearance date')
  const tools: Record<string, string> = { sandale: 'sandale', coutelas: 'coutelas', digrain: 'Digrain', capes: 'Capes' }
  const tool = tools[input.tool] ?? 'non renseigné'
  const date = new Intl.DateTimeFormat('fr-FR', { timeZone: 'America/Guadeloupe', day: '2-digit', month: '2-digit', year: 'numeric' }).format(input.observedAt)
  const time = new Intl.DateTimeFormat('fr-FR', { timeZone: 'America/Guadeloupe', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(input.observedAt)
  return `[Scolo] Nouvelle apparition le ${date} à ${time} (Guadeloupe). Moyen de défense : ${tool}. Tu paries sur la prochaine ? https://scolo.marvinl.com`
}

/** Call inside the same transaction as the appearance. Never backfills older history. */
export async function enqueueAppearanceTweet(transaction: Connection, input: TweetAppearance, enabled = false): Promise<void> {
  if (!enabled) return
  if (!Number.isSafeInteger(input.appearanceId) || input.appearanceId < 1 || !Number.isSafeInteger(input.createdAt)) throw new Error('Invalid tweet appearance')
  const content = buildAppearanceTweet(input)
  const existing = (await transaction.execute({ sql: 'SELECT content FROM scolo_tweet_outbox WHERE appearance_id = ?', args: [input.appearanceId] })).rows[0]
  if (existing) {
    if (existing.content !== content) throw new Error('Appearance tweet content conflict')
    return
  }
  await transaction.execute({
    sql: "INSERT INTO scolo_tweet_outbox (appearance_id, content, status, created_at) VALUES (?, ?, 'pending', ?)",
    args: [input.appearanceId, content, input.createdAt],
  })
}

export interface TweetDispatchResult { appearanceId: number; status: TweetStatus | 'disabled' | 'not-queued'; tweetId?: string; errorCode?: string }

/**
 * Call only after the game transaction has committed. Claiming is atomic across processes.
 * A crashed 'sending' row is deliberately never retried: reconcile it with X first.
 */
export async function dispatchAppearanceTweet(client: Connection, appearanceId: number, options: {
  enabled?: boolean
  publish: (text: string) => Promise<{ id: string }>
  now?: () => number
}): Promise<TweetDispatchResult> {
  if (!options.enabled) return { appearanceId, status: 'disabled' }
  const now = options.now ?? Date.now
  const claimed = (await client.execute({
    sql: "UPDATE scolo_tweet_outbox SET status = 'sending', attempted_at = ?, error_code = NULL WHERE appearance_id = ? AND status = 'pending' RETURNING content",
    args: [now(), appearanceId],
  })).rows[0]
  if (!claimed) {
    const row = (await client.execute({ sql: 'SELECT status, tweet_id, error_code FROM scolo_tweet_outbox WHERE appearance_id = ?', args: [appearanceId] })).rows[0]
    return row ? { appearanceId, status: String(row.status) as TweetStatus, ...(row.tweet_id ? { tweetId: String(row.tweet_id) } : {}), ...(row.error_code ? { errorCode: String(row.error_code) } : {}) } : { appearanceId, status: 'not-queued' }
  }
  let result: { id: string }
  try {
    result = await options.publish(String(claimed.content))
  } catch (error) {
    const publication = error instanceof TweetPublicationError ? error : new TweetPublicationError('unknown', 'TWITTER_OUTCOME_UNKNOWN')
    await client.execute({
      sql: "UPDATE scolo_tweet_outbox SET status = ?, error_code = ? WHERE appearance_id = ? AND status = 'sending'",
      args: [publication.outcome, publication.code, appearanceId],
    })
    return { appearanceId, status: publication.outcome, errorCode: publication.code }
  }
  // If persistence fails after X accepts, leave 'sending'. Retrying this function cannot repost.
  await client.execute({
    sql: "UPDATE scolo_tweet_outbox SET status = 'sent', tweet_id = ?, published_at = ? WHERE appearance_id = ? AND status = 'sending'",
    args: [result.id, now(), appearanceId],
  })
  return { appearanceId, status: 'sent', tweetId: result.id }
}
