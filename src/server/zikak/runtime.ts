import type { Client } from '@libsql/client'
import { env } from '../../env.js'
import { pointSyncConfiguration } from '../../config.js'
import { getDatabaseClient } from '../db'
import { createPointPublisher, dispatchPointBatch, pointSyncSummary, retryPointSync, type SyncConfiguration } from './outbox'

type Worker = { run: () => Promise<void>; stop: () => void; configuration: string }
const globalForSync = globalThis as unknown as { scoloPointWorkers?: WeakMap<Client, Worker> }
const workers = globalForSync.scoloPointWorkers ??= new WeakMap<Client, Worker>()

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
  let running: Promise<void> | undefined
  let stopped = false
  const run = () => {
    if (stopped) return Promise.resolve()
    if (running) return running
    running = (async () => {
      // Bound each pass so a backlog cannot monopolise the server.
      for (let index = 0; index < 20 && !stopped; index++) {
        if (await dispatchPointBatch(client, { applicationId: config.applicationId, publish }) !== 'sent') break
      }
    })().catch(() => {
      console.warn('Scolo: synchronisation Zikak en attente, la file sera reprise.')
    }).finally(() => { running = undefined })
    return running
  }
  const timer = setInterval(() => { void run() }, 15_000)
  timer.unref()
  workers.set(client, { run, configuration: key, stop: () => { stopped = true; clearInterval(timer) } })
  void run()
  return run
}

export async function getPointSyncStatus() {
  const config = pointSyncConfiguration(env)
  if (!config) return { enabled: false as const, sent: 0, pending: 0, blocked: 0 }
  return { enabled: true as const, ...await pointSyncSummary(getDatabaseClient(env)) }
}

/** Called after commit, or by an administrator retry. Never rolls back the game. */
export async function flushPointSync(retry = false) {
  const config = pointSyncConfiguration(env)
  if (!config) return getPointSyncStatus()
  const client = getDatabaseClient(env)
  if (retry) await retryPointSync(client)
  void startPointSyncWorker(client, config)()
  return getPointSyncStatus()
}
