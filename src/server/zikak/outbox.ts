import { randomUUID } from 'node:crypto'
import type { Client, Transaction } from '@libsql/client'

type Connection = Pick<Client, 'execute'>
export interface PointEntry {
  reference: string
  subject_id: string
  display_name?: string
  amount: number
  reason: string
  occurred_at: string
}
export interface PointBatch {
  batch_id: string
  entries: PointEntry[]
}
export interface PointReceipt {
  batch_id: string
  application_id: string
  applied: true
  entries_count: number
  applied_at: string
}
export interface SyncConfiguration {
  origin: string
  applicationId: string
  token: string
}

export const zikakOutboxSchema = [
  `CREATE TABLE IF NOT EXISTS scolo_zikak_batches (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    round_id TEXT NOT NULL REFERENCES scolo_rounds(id),
    application_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'blocked')),
    created_at INTEGER NOT NULL,
    next_attempt_at INTEGER NOT NULL,
    lease_until INTEGER,
    claim_id TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    receipt TEXT,
    sent_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS scolo_zikak_batch_entries (
    entry_id TEXT PRIMARY KEY NOT NULL,
    batch_id TEXT NOT NULL REFERENCES scolo_zikak_batches(id)
  )`,
]

/** The settlement owns this transaction. No network operation belongs here. */
export async function enqueuePointBatches(
  transaction: Transaction,
  input: {
    roundId: string
    applicationId: string
    now: number
    id?: () => string
  }
) {
  const rows = (
    await transaction.execute(`SELECT e.*, p.display_name
    FROM scolo_wallet_entries e JOIN scolo_players p ON p.id = e.player_id
    WHERE NOT EXISTS (SELECT 1 FROM scolo_zikak_batch_entries b WHERE b.entry_id = e.id)
    ORDER BY e.rowid`)
  ).rows
  for (let offset = 0; offset < rows.length; offset += 500) {
    const chunk = rows.slice(offset, offset + 500)
    const batch: PointBatch = {
      batch_id: (input.id ?? randomUUID)(),
      entries: chunk.map((row) => ({
        reference: String(row.id),
        subject_id: String(row.player_id),
        display_name: String(row.display_name),
        amount: Number(row.amount),
        reason: String(row.kind),
        occurred_at: new Date(Number(row.created_at)).toISOString(),
      })),
    }
    // Do not silently omit an invalid local movement and desynchronise the ledger.
    for (const entry of batch.entries) {
      if (
        !Number.isSafeInteger(entry.amount) ||
        entry.amount === 0 ||
        !entry.reference ||
        entry.reference.length > 128 ||
        !entry.subject_id ||
        entry.subject_id.length > 128 ||
        (entry.display_name?.length ?? 0) > 80
      )
        throw new Error('Invalid Zikak ledger movement')
    }
    const payload = JSON.stringify(batch)
    if (Buffer.byteLength(payload) > 1_048_576) throw new Error('Zikak batch exceeds body limit')
    await transaction.execute({
      sql: "INSERT INTO scolo_zikak_batches (id, round_id, application_id, payload, status, created_at, next_attempt_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)",
      args: [batch.batch_id, input.roundId, input.applicationId, payload, input.now, input.now],
    })
    for (const row of chunk)
      await transaction.execute({
        sql: 'INSERT INTO scolo_zikak_batch_entries (entry_id, batch_id) VALUES (?, ?)',
        args: [String(row.id), batch.batch_id],
      })
  }
}

export class PointSyncError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean
  ) {
    super(code)
  }
}

/** Bound upstream responses before allocating the complete body. */
export async function readProviderBody(response: Response, limit = 16_384): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Missing provider body')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > limit) throw new Error('Oversized provider body')
      chunks.push(chunk.value)
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

/** Never include provider text, credentials or headers in errors persisted by the outbox. */
export function createPointPublisher(config: SyncConfiguration, fetcher: typeof fetch = fetch) {
  return async (payload: string): Promise<PointReceipt> => {
    let response: Response
    try {
      response = await fetcher(`${config.origin}/api/integrations/v1/point-batches`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
        body: payload,
      })
    } catch {
      throw new PointSyncError('NETWORK_OR_TIMEOUT', true)
    }
    if (!response.ok) {
      if (response.status === 409) {
        try {
          const text = await readProviderBody(response, 4096)
          if ((JSON.parse(text) as { error?: string }).error === 'identity_unresolved')
            throw new PointSyncError('IDENTITY_UNRESOLVED', false)
        } catch (error) {
          if (error instanceof PointSyncError) throw error
        }
      }
      await response.body?.cancel()
      throw new PointSyncError(
        `HTTP_${response.status}`,
        response.status >= 500 || response.status === 408 || response.status === 429
      )
    }
    // A malformed/oversized acknowledgement leaves an unknown outcome: retry the same ID.
    let content = ''
    try {
      content = await readProviderBody(response)
    } catch {
      throw new PointSyncError('INVALID_RECEIPT', true)
    }
    try {
      const receipt = JSON.parse(content) as PointReceipt
      const batch = JSON.parse(payload) as PointBatch
      if (
        receipt.applied !== true ||
        receipt.batch_id !== batch.batch_id ||
        receipt.application_id !== config.applicationId ||
        receipt.entries_count !== batch.entries.length ||
        !Number.isFinite(Date.parse(receipt.applied_at))
      )
        throw new Error('Invalid receipt')
      return {
        batch_id: receipt.batch_id,
        application_id: receipt.application_id,
        applied: true,
        entries_count: receipt.entries_count,
        applied_at: receipt.applied_at,
      }
    } catch {
      throw new PointSyncError('INVALID_RECEIPT', true)
    }
  }
}

/** Oldest unsent batch gates the queue, including blocked errors and active leases. */
export async function dispatchPointBatch(
  client: Connection,
  options: {
    applicationId: string
    publish: (payload: string) => Promise<PointReceipt>
    now?: () => number
    batchId?: string
  }
): Promise<'idle' | 'sent' | 'pending' | 'blocked'> {
  const now = options.now ?? Date.now
  const claimId = randomUUID()
  const instant = now()
  const row = (
    await client.execute({
      sql: `UPDATE scolo_zikak_batches SET status = 'sending', claim_id = ?, lease_until = ?, attempts = attempts + 1
      WHERE sequence = (SELECT MIN(sequence) FROM scolo_zikak_batches WHERE status <> 'sent')
      AND application_id = ? AND ((status = 'pending' AND next_attempt_at <= ?) OR (status = 'sending' AND lease_until <= ?))
      AND (? IS NULL OR id = ?)
      RETURNING id, payload, attempts`,
      args: [
        claimId,
        instant + 30_000,
        options.applicationId,
        instant,
        instant,
        options.batchId ?? null,
        options.batchId ?? null,
      ],
    })
  ).rows[0]
  if (!row) return 'idle'
  try {
    const receipt = await options.publish(String(row.payload))
    await client.execute({
      sql: "UPDATE scolo_zikak_batches SET status = 'sent', receipt = ?, sent_at = ?, lease_until = NULL, claim_id = NULL, error_code = NULL WHERE id = ? AND claim_id = ?",
      args: [JSON.stringify(receipt), now(), String(row.id), claimId],
    })
    return 'sent'
  } catch (error) {
    const failure = error instanceof PointSyncError ? error : new PointSyncError('OUTCOME_UNKNOWN', true)
    const status = failure.retryable ? 'pending' : 'blocked'
    const delay = Math.min(3_600_000, 5000 * 2 ** Math.min(Number(row.attempts), 10))
    await client.execute({
      sql: 'UPDATE scolo_zikak_batches SET status = ?, error_code = ?, next_attempt_at = ?, lease_until = NULL, claim_id = NULL WHERE id = ? AND claim_id = ?',
      args: [status, failure.code, now() + delay, String(row.id), claimId],
    })
    return status
  }
}

/** Only an authenticated administrator may call this, after fixing the recorded cause. */
export async function retryPointSync(client: Connection, now = Date.now()) {
  await client.execute({
    sql: "UPDATE scolo_zikak_batches SET status = 'pending', next_attempt_at = ?, error_code = NULL WHERE sequence = (SELECT MIN(sequence) FROM scolo_zikak_batches WHERE status <> 'sent') AND status IN ('pending', 'blocked')",
    args: [now],
  })
}

export async function pointSyncSummary(client: Connection) {
  const rows = (await client.execute('SELECT status, COUNT(*) AS count FROM scolo_zikak_batches GROUP BY status')).rows
  const counts = Object.fromEntries(rows.map((row) => [String(row.status), Number(row.count)]))
  return {
    sent: counts.sent ?? 0,
    pending: (counts.pending ?? 0) + (counts.sending ?? 0),
    blocked: counts.blocked ?? 0,
  }
}
