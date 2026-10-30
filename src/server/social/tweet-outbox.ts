import type { Client } from '@libsql/client'

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

export interface TweetDispatchResult { appearanceId: number; status: TweetStatus | 'queued' | 'disabled' | 'not-queued'; tweetId?: string; errorCode?: string }
