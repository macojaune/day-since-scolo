import type { Client } from '@libsql/client'
import { clerkClient } from '@clerk/nextjs/server'
import { env } from '../../env.js'
import { pointSyncConfiguration } from '../../config.js'
import { getDatabaseClient } from '../db'
import {
  createPointPublisher,
  dispatchPointBatch,
  PointSyncError,
  retryPointSync,
  type PointBatch,
  type SyncConfiguration,
} from './outbox'
import { claimsFromClerk, createSubjectResolver } from './identity'
import { dispatchPointJob, pointJobsSummary, retryPointJobs } from './jobs'

type Worker = { run: () => Promise<void>; stop: () => void; configuration: string }
const globalForSync = globalThis as unknown as { scoloPointWorkers?: WeakMap<Client, Worker> }
const workers = (globalForSync.scoloPointWorkers ??= new WeakMap<Client, Worker>())

export function stopPointSyncWorker(client: Client) {
  workers.get(client)?.stop()
  workers.delete(client)
}

/** Node process worker. Durable rows survive restarts; leases coordinate replicas. */
export function startPointSyncWorker(client: Client, config: SyncConfiguration) {
  const key = JSON.stringify(config)
  const previous = workers.get(client)
  if (previous) {
    if (previous.configuration === key) return previous.run
    stopPointSyncWorker(client)
  }
  const publish = createPointPublisher(config)
  const resolver = createSubjectResolver(config)
  const claims = async (subjectId: string, clerkUserId: string) => {
    try {
      const user = await (await clerkClient()).users.getUser(clerkUserId)
      if (user.id !== clerkUserId) throw new Error('Clerk identity mismatch')
      return claimsFromClerk(subjectId, user)
    } catch {
      throw new PointSyncError('CLERK_PROFILE_UNAVAILABLE', true)
    }
  }
  let running: Promise<void> | undefined
  let stopped = false
  const run = () => {
    if (stopped) return Promise.resolve()
    if (running) return running
    running = (async () => {
      // Preserve already-frozen V1 payloads, but resolve every subject before any retry.
      const legacy = (
        await client.execute(`SELECT * FROM scolo_zikak_batches b WHERE b.status<>'sent'
        AND NOT EXISTS (SELECT 1 FROM scolo_zikak_jobs j WHERE j.batch_id=b.id)
        ORDER BY sequence LIMIT 1`)
      ).rows[0]
      if (
        legacy &&
        Number(legacy.next_attempt_at) <= Date.now() &&
        (legacy.status !== 'blocked' || legacy.error_code === 'IDENTITY_UNRESOLVED')
      ) {
        const batch = JSON.parse(String(legacy.payload)) as PointBatch
        let resolved = true
        for (const subject of new Set(batch.entries.map((entry) => entry.subject_id))) {
          const player = (
            await client.execute({ sql: 'SELECT clerk_user_id FROM scolo_players WHERE id=?', args: [subject] })
          ).rows[0]!
          const result = await resolver.resolve(await claims(subject, String(player.clerk_user_id)))
          if (!result?.can_sync_points) resolved = false
        }
        if (resolved) {
          await client.execute({
            sql: "UPDATE scolo_zikak_batches SET status='pending',next_attempt_at=? WHERE id=? AND status IN ('pending','blocked')",
            args: [Date.now(), String(legacy.id)],
          })
          await dispatchPointBatch(client, { applicationId: config.applicationId, publish, batchId: String(legacy.id) })
        } else
          await client.execute({
            sql: "UPDATE scolo_zikak_batches SET status='blocked',error_code='IDENTITY_UNRESOLVED',next_attempt_at=? WHERE id=? AND status IN ('pending','blocked')",
            args: [Date.now() + 60_000, String(legacy.id)],
          })
      }
      // Bound each pass so a backlog cannot monopolise the server.
      for (let index = 0; index < 20 && !stopped; index++) {
        if (
          (await dispatchPointJob(client, {
            applicationId: config.applicationId,
            publish,
            claims,
            resolve: resolver.resolve,
            resolution: resolver.get,
          })) === 'idle'
        )
          break
      }
    })()
      .catch(() => {
        console.warn('Scolo: synchronisation Zikak en attente, la file sera reprise.')
      })
      .finally(() => {
        running = undefined
      })
    return running
  }
  const timer = setInterval(() => {
    void run()
  }, 15_000)
  timer.unref()
  workers.set(client, {
    run,
    configuration: key,
    stop: () => {
      stopped = true
      clearInterval(timer)
    },
  })
  void run()
  return run
}

export async function getPointSyncStatus() {
  const config = pointSyncConfiguration(env)
  if (!config) return { enabled: false as const, sent: 0, pending: 0, blocked: 0, awaitingIdentity: 0 }
  return { enabled: true as const, ...(await pointJobsSummary(getDatabaseClient(env))) }
}

/** Called after commit, or by an administrator retry. Never rolls back the game. */
export async function flushPointSync(retry = false) {
  const config = pointSyncConfiguration(env)
  if (!config) return getPointSyncStatus()
  const client = getDatabaseClient(env)
  if (retry) {
    await retryPointSync(client)
    await retryPointJobs(client)
  }
  void startPointSyncWorker(client, config)()
  return getPointSyncStatus()
}
