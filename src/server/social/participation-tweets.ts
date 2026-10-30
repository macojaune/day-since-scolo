import type { Client } from '@libsql/client'
import { buildParticipationTweet, type ParticipationSnapshot } from './tweet-text'

type Connection = Pick<Client, 'execute'>
export const PARTICIPANT_MILESTONES = [10, 25, 50, 100] as const
export const PREDICTION_MILESTONES = [25, 50, 100, 250] as const
export const PARTICIPATION_INTERVAL = 86_400_000
export const participationSchema = [
  `CREATE TABLE IF NOT EXISTS scolo_participation_progress (
    round_id TEXT PRIMARY KEY NOT NULL REFERENCES scolo_rounds(id),
    participant_milestone INTEGER NOT NULL DEFAULT 0,
    prediction_milestone INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS scolo_participation_tweets (
    id TEXT PRIMARY KEY NOT NULL,
    round_id TEXT NOT NULL REFERENCES scolo_rounds(id),
    content TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','sending','sent','failed','unknown','skipped')),
    created_at INTEGER NOT NULL,
    attempted_at INTEGER,
    published_at INTEGER,
    tweet_id TEXT UNIQUE,
    error_code TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS scolo_one_pending_participation ON scolo_participation_tweets(round_id) WHERE status = 'pending'`,
]

async function snapshot(client: Connection, roundId: string, now: number): Promise<ParticipationSnapshot> {
  const counts = (await client.execute({
    sql: "SELECT COUNT(*) AS predictions, COUNT(DISTINCT player_id) AS participants, COALESCE(SUM(stake),0) AS pot FROM scolo_predictions WHERE round_id = ? AND status = 'active'",
    args: [roundId],
  })).rows[0]!
  const last = (await client.execute({ sql: 'SELECT MAX(created_at) AS since FROM "scolo-data" WHERE created_at <= ?', args: [Math.floor(now / 1000)] })).rows[0]!
  return { participants: Number(counts.participants), predictions: Number(counts.predictions), pot: Number(counts.pot), since: last.since === null ? null : Number(last.since) * 1000, now }
}

/** Inside the bet transaction, after a newly inserted prediction. Replays never reach this call. */
export async function enqueueParticipationTweet(client: Connection, roundId: string, now: number, enabled = false, newPlayerId?: string) {
  if (!enabled) return
  const data = await snapshot(client, roundId, now)
  const participants = PARTICIPANT_MILESTONES.filter(value => value <= data.participants).at(-1) ?? 0
  const predictions = data.participants >= 5 ? PREDICTION_MILESTONES.filter(value => value <= data.predictions).at(-1) ?? 0 : 0
  const progress = (await client.execute({ sql: 'SELECT participant_milestone, prediction_milestone FROM scolo_participation_progress WHERE round_id = ?', args: [roundId] })).rows[0]
  let previousParticipants = Number(progress?.participant_milestone ?? 0)
  let previousPredictions = Number(progress?.prediction_milestone ?? 0)
  if (!progress && newPlayerId) {
    // Activation on an existing round must not announce thresholds crossed before activation.
    const playerPredictions = Number((await client.execute({ sql: "SELECT COUNT(*) AS n FROM scolo_predictions WHERE round_id=? AND player_id=? AND status='active'", args: [roundId, newPlayerId] })).rows[0]!.n)
    const beforeParticipants = data.participants - (playerPredictions === 1 ? 1 : 0)
    previousParticipants = PARTICIPANT_MILESTONES.filter(value => value <= beforeParticipants).at(-1) ?? 0
    previousPredictions = beforeParticipants >= 5 ? PREDICTION_MILESTONES.filter(value => value < data.predictions).at(-1) ?? 0 : 0
  }
  if (participants <= previousParticipants && predictions <= previousPredictions) return
  await client.execute({
    sql: `INSERT INTO scolo_participation_progress (round_id, participant_milestone, prediction_milestone) VALUES (?, ?, ?)
      ON CONFLICT(round_id) DO UPDATE SET participant_milestone=excluded.participant_milestone, prediction_milestone=excluded.prediction_milestone`,
    args: [roundId, participants, predictions],
  })
  const content = buildParticipationTweet(data)
  const updated = await client.execute({ sql: "UPDATE scolo_participation_tweets SET content = ? WHERE round_id = ? AND status = 'pending'", args: [content, roundId] })
  if (!updated.rowsAffected) await client.execute({
    sql: "INSERT INTO scolo_participation_tweets (id, round_id, content, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
    args: [`participation:${roundId}:${participants}:${predictions}`, roundId, content, now],
  })
}

/** Refresh counts just before the atomic dispatch claim; expired rounds never get promoted. */
export async function nextParticipationTweet(client: Client, now = Date.now()): Promise<string | null> {
  const transaction = await client.transaction('write')
  try {
    await transaction.execute(`UPDATE scolo_participation_tweets SET status='skipped', error_code='ROUND_CLOSED'
      WHERE status='pending' AND round_id IN (SELECT id FROM scolo_rounds WHERE status<>'open')`)
    const recent = (await transaction.execute({ sql: "SELECT 1 FROM scolo_participation_tweets WHERE attempted_at > ? OR published_at > ? OR status IN ('sending','unknown') LIMIT 1", args: [now - PARTICIPATION_INTERVAL, now - PARTICIPATION_INTERVAL] })).rows.length
    const pending = recent ? undefined : (await transaction.execute("SELECT id, round_id FROM scolo_participation_tweets WHERE status='pending' ORDER BY created_at,id LIMIT 1")).rows[0]
    if (pending) await transaction.execute({
      sql: "UPDATE scolo_participation_tweets SET content=? WHERE id=? AND status='pending'",
      args: [buildParticipationTweet(await snapshot(transaction, String(pending.round_id), now)), String(pending.id)],
    })
    await transaction.commit()
    return pending ? String(pending.id) : null
  } catch (error) { await transaction.rollback(); throw error }
  finally { transaction.close() }
}
