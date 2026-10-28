import { env } from '../../env.js'
import { getDatabaseClient } from '../db'
import { dispatchAppearanceTweet } from './tweet-outbox'
import { createTwitterPublisher } from './twitter'

/** Runs after settlement commits. A notification failure never reverses game results. */
export async function publishAppearanceIfEnabled(appearanceId: number) {
  if (env.SCOLO_WALLET_MODE !== 'scolo' || env.SCOLO_TWEETS_ENABLED !== 'true') {
    return { appearanceId, status: 'disabled' as const }
  }
  try {
    return await dispatchAppearanceTweet(getDatabaseClient(env), appearanceId, {
      enabled: true,
      publish: createTwitterPublisher({
        appKey: env.TWITTER_API_KEY!,
        appSecret: env.TWITTER_API_SECRET!,
        accessToken: env.TWITTER_ACCESS_TOKEN!,
        accessSecret: env.TWITTER_ACCESS_SECRET!,
      }),
    })
  } catch {
    // Do not log provider responses, request headers or credentials.
    console.warn('Scolo: publication status unavailable for appearance', appearanceId)
    return { appearanceId, status: 'unavailable' as const }
  }
}
