import type { Client } from '@libsql/client'
import type { BufferConfiguration, BufferPost } from './buffer'
import { TweetPublicationError } from './publication-error'
import type { TweetDispatchResult } from './tweet-outbox'

type Connection = Pick<Client, 'execute'>
type Publisher = { publish: (text: string) => Promise<BufferPost>; getPost: (id: string) => Promise<BufferPost> }
export const bufferPostsSchema = `CREATE TABLE IF NOT EXISTS scolo_buffer_posts (
  appearance_id INTEGER PRIMARY KEY NOT NULL REFERENCES scolo_tweet_outbox(appearance_id),
  post_id TEXT UNIQUE NOT NULL,
  channel_id TEXT NOT NULL,
  next_check_at INTEGER NOT NULL,
  check_count INTEGER NOT NULL DEFAULT 0
)`

async function saveResult(client: Connection, appearanceId: number, post: BufferPost, now: number) {
  if (post.status === 'queued') return
  await client.execute({
    sql: "UPDATE scolo_tweet_outbox SET status = ?, tweet_id = ?, published_at = ?, error_code = ? WHERE appearance_id = ? AND status = 'sending'",
    args: [post.status, post.tweetId ?? null, post.status === 'sent' ? now : null, post.status === 'failed' ? 'BUFFER_PUBLICATION_FAILED' : null, appearanceId],
  })
}

/** Claims the existing appearance outbox. Legacy sending/unknown rows are never reposted. */
export async function dispatchBufferAppearance(client: Connection, appearanceId: number, options: {
  enabled?: boolean; publisher: Publisher; config: Pick<BufferConfiguration, 'channelId'>; now?: () => number
}): Promise<TweetDispatchResult & { bufferPostId?: string }> {
  if (!options.enabled) return { appearanceId, status: 'disabled' }
  const now = options.now ?? Date.now
  const claimed = (await client.execute({
    sql: "UPDATE scolo_tweet_outbox SET status = 'sending', attempted_at = ?, error_code = NULL WHERE appearance_id = ? AND status = 'pending' RETURNING content",
    args: [now(), appearanceId],
  })).rows[0]
  if (!claimed) {
    const row = (await client.execute({
      sql: `SELECT o.status, o.tweet_id, o.error_code, b.post_id FROM scolo_tweet_outbox o
        LEFT JOIN scolo_buffer_posts b USING (appearance_id) WHERE o.appearance_id = ?`, args: [appearanceId],
    })).rows[0]
    if (!row) return { appearanceId, status: 'not-queued' }
    return {
      appearanceId, status: row.status === 'sending' && row.post_id ? 'queued' : String(row.status) as TweetDispatchResult['status'],
      ...(row.post_id ? { bufferPostId: String(row.post_id) } : {}),
      ...(row.tweet_id ? { tweetId: String(row.tweet_id) } : {}), ...(row.error_code ? { errorCode: String(row.error_code) } : {}),
    }
  }
  let post: BufferPost
  try {
    post = await options.publisher.publish(String(claimed.content))
  } catch (error) {
    const failure = error instanceof TweetPublicationError ? error : new TweetPublicationError('unknown', 'BUFFER_OUTCOME_UNKNOWN')
    await client.execute({ sql: "UPDATE scolo_tweet_outbox SET status = ?, error_code = ? WHERE appearance_id = ? AND status = 'sending'", args: [failure.outcome, failure.code, appearanceId] })
    return { appearanceId, status: failure.outcome, errorCode: failure.code }
  }
  // Persist the Buffer reference separately from the eventual X ID. A DB failure leaves sending, never pending.
  await client.execute({
    sql: 'INSERT INTO scolo_buffer_posts (appearance_id, post_id, channel_id, next_check_at) VALUES (?, ?, ?, ?)',
    args: [appearanceId, post.bufferPostId, options.config.channelId, now() + 300_000],
  })
  await saveResult(client, appearanceId, post, now())
  return { appearanceId, status: post.status, bufferPostId: post.bufferPostId, ...(post.tweetId ? { tweetId: post.tweetId } : {}) }
}

/** Read-only provider checks, bounded to 12 per post to preserve the free API quota. */
export async function reconcileBufferPosts(client: Connection, publisher: Pick<Publisher, 'getPost'>, channelId: string, now = Date.now()) {
  const due = (await client.execute({
    sql: `SELECT b.appearance_id, b.post_id, b.check_count FROM scolo_buffer_posts b
      JOIN scolo_tweet_outbox o USING (appearance_id) WHERE o.status = 'sending'
      AND b.channel_id = ? AND b.next_check_at <= ? AND b.check_count < 12 ORDER BY b.next_check_at LIMIT 10`,
    args: [channelId, now],
  })).rows
  for (const row of due) {
    const claim = await client.execute({
      sql: 'UPDATE scolo_buffer_posts SET next_check_at = ?, check_count = check_count + 1 WHERE appearance_id = ? AND next_check_at <= ? AND check_count = ?',
      args: [now + 300_000, Number(row.appearance_id), now, Number(row.check_count)],
    })
    if (!claim.rowsAffected) continue
    try { await saveResult(client, Number(row.appearance_id), await publisher.getPost(String(row.post_id)), now) }
    catch {
      // A failed read never authorizes a second createPost. Stop after the bounded checks.
      await client.execute({ sql: "UPDATE scolo_tweet_outbox SET error_code = 'BUFFER_STATUS_UNAVAILABLE' WHERE appearance_id = ? AND status = 'sending'", args: [Number(row.appearance_id)] })
    }
  }
  return due.length
}
