import { randomUUID } from 'node:crypto'
import type { Client, Transaction } from '@libsql/client'
import { PointSyncError, type PointEntry, type PointBatch, type PointReceipt } from './outbox'
import type { SubjectClaims, SubjectResolution } from './identity'

export const pointJobsSchema = [
  `CREATE TABLE IF NOT EXISTS scolo_zikak_jobs (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    round_id TEXT NOT NULL REFERENCES scolo_rounds(id),
    application_id TEXT NOT NULL,
    subject_id TEXT NOT NULL REFERENCES scolo_players(id),
    movements TEXT NOT NULL,
    claims TEXT,
    resolution_id TEXT,
    resolution_reason TEXT,
    batch_id TEXT UNIQUE REFERENCES scolo_zikak_batches(id),
    status TEXT NOT NULL CHECK (status IN ('pending', 'identity_pending', 'sending', 'sent', 'blocked')),
    created_at INTEGER NOT NULL,
    next_attempt_at INTEGER NOT NULL,
    claim_id TEXT,
    lease_until INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    error_code TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS scolo_zikak_job_entries (
    entry_id TEXT PRIMARY KEY NOT NULL,
    job_id TEXT NOT NULL REFERENCES scolo_zikak_jobs(id)
  )`,
]

/** Snapshot immutable movements inside the settlement, independently for each player. */
export async function enqueuePointJobs(
  tx: Transaction,
  input: { roundId: string; applicationId: string; now: number; id?: () => string }
) {
  const rows = (
    await tx.execute(`SELECT e.*, p.display_name FROM scolo_wallet_entries e JOIN scolo_players p ON p.id=e.player_id
    WHERE NOT EXISTS (SELECT 1 FROM scolo_zikak_job_entries j WHERE j.entry_id=e.id)
      AND NOT EXISTS (SELECT 1 FROM scolo_zikak_batch_entries b WHERE b.entry_id=e.id)
    ORDER BY e.rowid`)
  ).rows
  const subjects = new Map<string, PointEntry[]>()
  for (const row of rows) {
    const subject = String(row.player_id)
    const movement: PointEntry = {
      reference: String(row.id),
      subject_id: subject,
      display_name: String(row.display_name),
      amount: Number(row.amount),
      reason: String(row.kind),
      occurred_at: new Date(Number(row.created_at)).toISOString(),
    }
    if (
      !Number.isSafeInteger(movement.amount) ||
      movement.amount === 0 ||
      movement.reference.length > 128 ||
      subject.length > 128
    )
      throw new Error('Invalid ledger movement')
    const entries = subjects.get(subject) ?? []
    entries.push(movement)
    subjects.set(subject, entries)
  }
  for (const [subject, entries] of subjects)
    for (let offset = 0; offset < entries.length; offset += 500) {
      const movements = entries.slice(offset, offset + 500)
      const id = (input.id ?? randomUUID)()
      await tx.execute({
        sql: "INSERT INTO scolo_zikak_jobs (id,round_id,application_id,subject_id,movements,status,created_at,next_attempt_at) VALUES (?,?,?,?,?,'pending',?,?)",
        args: [id, input.roundId, input.applicationId, subject, JSON.stringify(movements), input.now, input.now],
      })
      for (const movement of movements)
        await tx.execute({
          sql: 'INSERT INTO scolo_zikak_job_entries (entry_id,job_id) VALUES (?,?)',
          args: [movement.reference, id],
        })
    }
}

export interface PointJobDependencies {
  applicationId: string
  claims: (subjectId: string, clerkUserId: string) => Promise<SubjectClaims>
  resolve: (claims: SubjectClaims) => Promise<SubjectResolution | null>
  resolution: (subjectId: string) => Promise<SubjectResolution | null>
  publish: (payload: string) => Promise<PointReceipt>
  now?: () => number
}

/** A failed/pending subject gates only its own later jobs. Other players keep progressing. */
export async function dispatchPointJob(
  client: Client,
  deps: PointJobDependencies
): Promise<'idle' | 'sent' | 'pending' | 'identity_pending' | 'blocked'> {
  const now = deps.now ?? Date.now
  const claim = randomUUID(),
    instant = now()
  const row = (
    await client.execute({
      sql: `UPDATE scolo_zikak_jobs SET status='sending',claim_id=?,lease_until=?,attempts=attempts+1
      WHERE sequence=(SELECT j.sequence FROM scolo_zikak_jobs j WHERE j.application_id=?
        AND ((j.status IN ('pending','identity_pending') AND j.next_attempt_at<=?) OR (j.status='sending' AND j.lease_until<=?))
        AND NOT EXISTS (SELECT 1 FROM scolo_zikak_jobs older WHERE older.application_id=j.application_id AND older.subject_id=j.subject_id AND older.sequence<j.sequence AND older.status<>'sent')
        AND NOT EXISTS (SELECT 1 FROM scolo_zikak_batches old JOIN scolo_zikak_batch_entries be ON be.batch_id=old.id JOIN scolo_wallet_entries e ON e.id=be.entry_id
          WHERE old.status<>'sent' AND e.player_id=j.subject_id AND NOT EXISTS (SELECT 1 FROM scolo_zikak_jobs owner WHERE owner.batch_id=old.id))
        ORDER BY j.sequence LIMIT 1)
      RETURNING *`,
      args: [claim, instant + 90_000, deps.applicationId, instant, instant],
    })
  ).rows[0]
  if (!row) return 'idle'
  const id = String(row.id),
    subject = String(row.subject_id)
  const attempts = Number(row.attempts)
  async function defer(
    status: 'pending' | 'identity_pending' | 'blocked',
    error: string | null,
    reason?: string,
    resolutionId?: string
  ) {
    const delay =
      status === 'identity_pending' ? 60_000 : Math.min(3_600_000, 5000 * 2 ** Math.min(attempts, 10))
    await client.execute({
      sql: 'UPDATE scolo_zikak_jobs SET status=?,error_code=?,resolution_reason=COALESCE(?,resolution_reason),resolution_id=COALESCE(?,resolution_id),next_attempt_at=?,claim_id=NULL,lease_until=NULL WHERE id=? AND claim_id=?',
      args: [status, error, reason ?? null, resolutionId ?? null, now() + delay, id, claim],
    })
    return status
  }
  try {
    let resolution: SubjectResolution | null
    if (row.claims && row.resolution_id) resolution = await deps.resolution(subject)
    else {
      const player = (
        await client.execute({ sql: 'SELECT clerk_user_id FROM scolo_players WHERE id=?', args: [subject] })
      ).rows[0]!
      const claims = row.claims
        ? (JSON.parse(String(row.claims)) as SubjectClaims)
        : await deps.claims(subject, String(player.clerk_user_id))
      if (claims.subject_id !== subject) throw new PointSyncError('IDENTITY_SUBJECT_MISMATCH', false)
      await client.execute({
        sql: 'UPDATE scolo_zikak_jobs SET claims=? WHERE id=? AND claim_id=?',
        args: [JSON.stringify(claims), id, claim],
      })
      resolution = await deps.resolve(claims)
    }
    if (!resolution || !resolution.can_sync_points)
      return defer('identity_pending', null, resolution?.reason, resolution?.resolution_id)
    if (resolution.application_id !== deps.applicationId || resolution.subject_id !== subject)
      throw new PointSyncError('IDENTITY_SOURCE_MISMATCH', false)
    // Freeze a real API batch only after resolution, in one durable transaction.
    const tx = await client.transaction('write')
    let payload: string | undefined, batchId: string | undefined
    try {
      const owned = (
        await tx.execute({ sql: 'SELECT batch_id FROM scolo_zikak_jobs WHERE id=? AND claim_id=?', args: [id, claim] })
      ).rows[0]
      if (owned) {
        batchId = owned.batch_id ? String(owned.batch_id) : randomUUID()
        if (!owned.batch_id) {
          const batch: PointBatch = { batch_id: batchId, entries: JSON.parse(String(row.movements)) as PointEntry[] }
          payload = JSON.stringify(batch)
          if (Buffer.byteLength(payload) > 1_048_576) throw new PointSyncError('BATCH_TOO_LARGE', false)
          await tx.execute({
            sql: "INSERT INTO scolo_zikak_batches (id,round_id,application_id,payload,status,created_at,next_attempt_at) VALUES (?,?,?,?,'pending',?,?)",
            args: [batchId, String(row.round_id), deps.applicationId, payload, now(), now()],
          })
          for (const entry of batch.entries)
            await tx.execute({
              sql: 'INSERT INTO scolo_zikak_batch_entries (entry_id,batch_id) VALUES (?,?)',
              args: [entry.reference, batchId],
            })
          await tx.execute({
            sql: 'UPDATE scolo_zikak_jobs SET batch_id=?,resolution_id=?,resolution_reason=? WHERE id=? AND claim_id=?',
            args: [batchId, resolution.resolution_id, resolution.reason, id, claim],
          })
        } else
          payload = String(
            (await tx.execute({ sql: 'SELECT payload FROM scolo_zikak_batches WHERE id=?', args: [batchId] })).rows[0]!
              .payload
          )
      }
      await tx.commit()
    } catch (error) {
      await tx.rollback()
      throw error
    } finally {
      tx.close()
    }
    if (!payload || !batchId) return 'pending'
    const receipt = await deps.publish(payload)
    const ack = await client.transaction('write')
    try {
      const saved = await ack.execute({
        sql: "UPDATE scolo_zikak_jobs SET status='sent',error_code=NULL,claim_id=NULL,lease_until=NULL WHERE id=? AND claim_id=? RETURNING id",
        args: [id, claim],
      })
      if (saved.rows.length)
        await ack.execute({
          sql: "UPDATE scolo_zikak_batches SET status='sent',receipt=?,sent_at=?,error_code=NULL WHERE id=?",
          args: [JSON.stringify(receipt), now(), batchId],
        })
      await ack.commit()
    } catch (error) {
      await ack.rollback()
      throw error
    } finally {
      ack.close()
    }
    return 'sent'
  } catch (error) {
    const failure = error instanceof PointSyncError ? error : new PointSyncError('OUTCOME_UNKNOWN', true)
    return defer(
      failure.code === 'IDENTITY_UNRESOLVED' ? 'identity_pending' : failure.retryable ? 'pending' : 'blocked',
      failure.code
    )
  }
}

export async function retryPointJobs(client: Client, now = Date.now()) {
  await client.execute({
    sql: "UPDATE scolo_zikak_jobs SET status='pending',next_attempt_at=?,error_code=NULL,claims=NULL,resolution_id=NULL WHERE status IN ('pending','identity_pending','blocked')",
    args: [now],
  })
}

export async function pointJobsSummary(client: Client) {
  const counts = (
    await client.execute(`SELECT status,COUNT(*) AS n FROM (
    SELECT status FROM scolo_zikak_jobs UNION ALL SELECT status FROM scolo_zikak_batches b WHERE NOT EXISTS (SELECT 1 FROM scolo_zikak_jobs j WHERE j.batch_id=b.id)
  ) GROUP BY status`)
  ).rows
  const byStatus = Object.fromEntries(counts.map((row) => [String(row.status), Number(row.n)]))
  const awaiting = (
    await client.execute("SELECT COUNT(DISTINCT subject_id) AS n FROM scolo_zikak_jobs WHERE status='identity_pending'")
  ).rows[0]!
  return {
    sent: byStatus.sent ?? 0,
    pending: (byStatus.pending ?? 0) + (byStatus.sending ?? 0),
    blocked: byStatus.blocked ?? 0,
    awaitingIdentity: Number(awaiting.n),
  }
}
