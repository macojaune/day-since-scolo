import type { Client } from '@libsql/client'
import { env } from '../../env.js'
import { getDatabaseClient } from '../db'
import { createGameService, type GameService } from './service'
import type { WalletMode } from './types'
import { applicationEnvironment } from '../../config.js'
import { startAppearancePublicationWorker } from '../social/appearance-publication'

const globalForGame = globalThis as unknown as { scoloGame?: { client: Client; mode: WalletMode; tweetEnabled: boolean; service: Promise<GameService> } }

export async function getGameService(): Promise<GameService> {
  const client = getDatabaseClient(env)
  const mode = env.SCOLO_WALLET_MODE
  const tweetEnabled = env.SCOLO_TWEETS_ENABLED === 'true'
  if (!globalForGame.scoloGame || globalForGame.scoloGame.client !== client || globalForGame.scoloGame.mode !== mode || globalForGame.scoloGame.tweetEnabled !== tweetEnabled) {
    const service = createGameService(client, { walletMode: mode, environment: applicationEnvironment(env), tweetEnabled })
    globalForGame.scoloGame = { client, mode, tweetEnabled, service }
    void service.catch(() => {
      if (globalForGame.scoloGame?.service === service) globalForGame.scoloGame = undefined
    })
  }
  const service = await globalForGame.scoloGame.service
  startAppearancePublicationWorker(client)
  return service
}

export { GameError } from './types'
export type * from './types'
