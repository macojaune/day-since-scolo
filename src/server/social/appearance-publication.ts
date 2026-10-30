import type { Client } from '@libsql/client'
import { env } from '../../env.js'
import { applicationEnvironment } from '../../config.js'
import { getDatabaseClient } from '../db'
import { createBufferPublisher } from './buffer'
import { nextParticipationTweet } from './participation-tweets'
import { dispatchBufferAppearance, dispatchBufferParticipation, reconcileBufferPosts } from './buffer-outbox'

type Worker = { stop: () => void; key: string }
const globalForTweets = globalThis as unknown as { scoloTweetWorkers?: WeakMap<Client, Worker> }
const workers = (globalForTweets.scoloTweetWorkers ??= new WeakMap<Client, Worker>())

function configuration() {
  if (applicationEnvironment(env) !== 'prod' || env.SCOLO_WALLET_MODE !== 'scolo' || env.SCOLO_TWEETS_ENABLED !== 'true') return null
  return { apiKey: env.BUFFER_API_KEY!, channelId: env.BUFFER_CHANNEL_ID! }
}

/** Started only after game schema verification. Durable rows survive restarts. */
export function startAppearancePublicationWorker(client: Client) {
  const config = configuration()
  const previous = workers.get(client)
  const key = config ? JSON.stringify(config) : ''
  if (previous?.key === key) return
  previous?.stop()
  workers.delete(client)
  if (!config) return
  const publisher = createBufferPublisher(config)
  let running = false
  let stopped = false
  const run = async () => {
    if (running || stopped) return
    running = true
    try {
      await reconcileBufferPosts(client, publisher, config.channelId)
      // One pending announcement per pass. Never retries failed, sending or unknown creates.
      const pending = (await client.execute("SELECT appearance_id FROM scolo_tweet_outbox WHERE status = 'pending' ORDER BY created_at LIMIT 1")).rows[0]
      if (pending && !stopped) await dispatchBufferAppearance(client, Number(pending.appearance_id), { enabled: true, publisher, config })
      const participationId = stopped ? null : await nextParticipationTweet(client)
      if (participationId && !stopped) await dispatchBufferParticipation(client, participationId, { enabled: true, publisher, config })
    } catch { console.warn('Scolo: suivi Buffer indisponible, vérifier la file de publication.') }
    finally { running = false }
  }
  const timer = setInterval(() => { void run() }, 60_000)
  timer.unref()
  workers.set(client, { key, stop: () => { stopped = true; clearInterval(timer) } })
  void run()
}

/** Runs after settlement commits. A notification failure never reverses game results. */
export async function publishAppearanceIfEnabled(appearanceId: number) {
  const config = configuration()
  if (!config) return { appearanceId, status: 'disabled' as const }
  try {
    return await dispatchBufferAppearance(getDatabaseClient(env), appearanceId, {
      enabled: true, publisher: createBufferPublisher(config), config,
    })
  } catch {
    console.warn('Scolo: publication status unavailable for appearance', appearanceId)
    return { appearanceId, status: 'unavailable' as const }
  }
}
