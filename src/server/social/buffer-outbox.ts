import type { Client } from '@libsql/client'
import type { BufferConfiguration, BufferPost } from './buffer'
import { TweetPublicationError } from './publication-error'
import { PARTICIPATION_INTERVAL } from './participation-tweets'
import type { TweetDispatchResult } from './tweet-outbox'

type Connection = Pick<Client, 'execute'>
type Publisher = { publish: (text: string) => Promise<BufferPost>; getPost: (id: string) => Promise<BufferPost> }
type DispatchOptions = { enabled?: boolean; publisher: Publisher; config: Pick<BufferConfiguration, 'channelId'>; now?: () => number }
type DeliveryResult = Omit<TweetDispatchResult, 'appearanceId'> & { bufferPostId?: string }
const stores = {
  appearance: { table: 'scolo_tweet_outbox', key: 'appearance_id', receipts: 'scolo_buffer_posts' },
  participation: { table: 'scolo_participation_tweets', key: 'id', receipts: 'scolo_participation_buffer_posts' },
} as const
type Source = keyof typeof stores

export const bufferPostsSchema = `CREATE TABLE IF NOT EXISTS scolo_buffer_posts (
  appearance_id INTEGER PRIMARY KEY NOT NULL REFERENCES scolo_tweet_outbox(appearance_id),
  post_id TEXT UNIQUE NOT NULL,
  channel_id TEXT NOT NULL,
  next_check_at INTEGER NOT NULL,
  check_count INTEGER NOT NULL DEFAULT 0
)`
export const participationBufferPostsSchema = `CREATE TABLE IF NOT EXISTS scolo_participation_buffer_posts (
  id TEXT PRIMARY KEY NOT NULL REFERENCES scolo_participation_tweets(id),
  post_id TEXT UNIQUE NOT NULL,
  channel_id TEXT NOT NULL,
  next_check_at INTEGER NOT NULL,
  check_count INTEGER NOT NULL DEFAULT 0
)`

async function saveResult(client: Connection, source: Source, id: string | number, post: BufferPost, now: number) {
  if (post.status === 'queued') return
  const store = stores[source]
  await client.execute({
    sql: `UPDATE ${store.table} SET status = ?, tweet_id = ?, published_at = ?, error_code = ? WHERE ${store.key} = ? AND status = 'sending'`,
    args: [post.status, post.tweetId ?? null, post.status === 'sent' ? now : null, post.status === 'failed' ? 'BUFFER_PUBLICATION_FAILED' : null, id],
  })
}

/** Store names come only from the closed mapping above. Never retries an uncertain creation. */
async function dispatch(client: Connection, source: Source, id: string | number, options: DispatchOptions): Promise<DeliveryResult> {
  if (!options.enabled) return { status: 'disabled' }
  const store = stores[source]
  const clock = options.now ?? Date.now
  const now = clock()
  const eligibility = source === 'participation' ? ` AND EXISTS (SELECT 1 FROM scolo_rounds WHERE id = round_id AND status = 'open')
    AND NOT EXISTS (SELECT 1 FROM scolo_participation_tweets WHERE attempted_at > ? OR published_at > ? OR status IN ('sending','unknown'))` : ''
  // The rate check and claim are one SQLite write, shared across replicas and rounds.
  const claimed = (await client.execute({
    sql: `UPDATE ${store.table} SET status = 'sending', attempted_at = ?, error_code = NULL WHERE ${store.key} = ? AND status = 'pending'${eligibility} RETURNING content`,
    args: [now, id, ...(source === 'participation' ? [now - PARTICIPATION_INTERVAL, now - PARTICIPATION_INTERVAL] : [])],
  })).rows[0]
  if (!claimed) {
    const row = (await client.execute({
      sql: `SELECT o.status, o.tweet_id, o.error_code, b.post_id FROM ${store.table} o
        LEFT JOIN ${store.receipts} b USING (${store.key}) WHERE o.${store.key} = ?`, args: [id],
    })).rows[0]
    if (!row || row.status === 'skipped') return { status: 'not-queued' }
    return {
      status: row.status === 'sending' && row.post_id ? 'queued' : String(row.status) as DeliveryResult['status'],
      ...(row.post_id ? { bufferPostId: String(row.post_id) } : {}),
      ...(row.tweet_id ? { tweetId: String(row.tweet_id) } : {}), ...(row.error_code ? { errorCode: String(row.error_code) } : {}),
    }
  }
  let post: BufferPost
  try { post = await options.publisher.publish(String(claimed.content)) }
  catch (error) {
    const failure = error instanceof TweetPublicationError ? error : new TweetPublicationError('unknown', 'BUFFER_OUTCOME_UNKNOWN')
    await client.execute({ sql: `UPDATE ${store.table} SET status = ?, error_code = ? WHERE ${store.key} = ? AND status = 'sending'`, args: [failure.outcome, failure.code, id] })
    return { status: failure.outcome, errorCode: failure.code }
  }
  // A DB failure after acceptance leaves sending, never pending; Buffer IDs are separate from X IDs.
  const receivedAt = clock()
  await client.execute({
    sql: `INSERT INTO ${store.receipts} (${store.key}, post_id, channel_id, next_check_at) VALUES (?, ?, ?, ?)`,
    args: [id, post.bufferPostId, options.config.channelId, receivedAt + 300_000],
  })
  await saveResult(client, source, id, post, receivedAt)
  return { status: post.status, bufferPostId: post.bufferPostId, ...(post.tweetId ? { tweetId: post.tweetId } : {}) }
}

export async function dispatchBufferAppearance(client: Connection, appearanceId: number, options: DispatchOptions) {
  return { appearanceId, ...await dispatch(client, 'appearance', appearanceId, options) }
}
export async function dispatchBufferParticipation(client: Connection, id: string, options: DispatchOptions) {
  return { id, ...await dispatch(client, 'participation', id, options) }
}

/** Read-only provider checks, bounded to 12 per post to preserve the free API quota. */
export async function reconcileBufferPosts(client: Connection, publisher: Pick<Publisher, 'getPost'>, channelId: string, now?: number) {
  const checkedAt = now ?? Date.now()
  let checked = 0
  for (const source of Object.keys(stores) as Source[]) {
    const store = stores[source]
    const due = (await client.execute({
      sql: `SELECT b.${store.key} AS message_id, b.post_id, b.check_count FROM ${store.receipts} b
        JOIN ${store.table} o USING (${store.key}) WHERE o.status = 'sending'
        AND b.channel_id = ? AND b.next_check_at <= ? AND b.check_count < 12 ORDER BY b.next_check_at LIMIT 10`,
      args: [channelId, checkedAt],
    })).rows
    for (const row of due) {
      const id = source === 'appearance' ? Number(row.message_id) : String(row.message_id)
      const claim = await client.execute({
        sql: `UPDATE ${store.receipts} SET next_check_at = ?, check_count = check_count + 1 WHERE ${store.key} = ? AND next_check_at <= ? AND check_count = ?`,
        args: [checkedAt + 300_000, id, checkedAt, Number(row.check_count)],
      })
      if (!claim.rowsAffected) continue
      checked++
      try { await saveResult(client, source, id, await publisher.getPost(String(row.post_id)), now ?? Date.now()) }
      catch {
        await client.execute({ sql: `UPDATE ${store.table} SET error_code = 'BUFFER_STATUS_UNAVAILABLE' WHERE ${store.key} = ? AND status = 'sending'`, args: [id] })
      }
    }
  }
  return checked
}
