import type { Client } from '@libsql/client'
import { env } from '../../env.js'
import { getDatabaseClient } from '../db'
import { createGameService, type GameService } from './service'
import type { WalletMode } from './types'
import { pointSyncConfiguration } from '../../config.js'
import { startPointSyncWorker, stopPointSyncWorker } from '../zikak/runtime'

const globalForGame = globalThis as unknown as { scoloGame?: { client: Client; mode: WalletMode; tweetEnabled: boolean; zikakApplicationId?: string; service: Promise<GameService> } }

export async function getGameService(): Promise<GameService> {
  const client = getDatabaseClient(env)
  const mode = env.SCOLO_WALLET_MODE
  const tweetEnabled = env.SCOLO_TWEETS_ENABLED === 'true'
  const sync = pointSyncConfiguration(env)
  if (!sync) stopPointSyncWorker(client)
  if (!globalForGame.scoloGame || globalForGame.scoloGame.client !== client || globalForGame.scoloGame.mode !== mode || globalForGame.scoloGame.tweetEnabled !== tweetEnabled || globalForGame.scoloGame.zikakApplicationId !== sync?.applicationId) {
    stopPointSyncWorker(client)
    const service = createGameService(client, { walletMode: mode, tweetEnabled, zikakApplicationId: sync?.applicationId })
    globalForGame.scoloGame = { client, mode, tweetEnabled, zikakApplicationId: sync?.applicationId, service }
    void service.catch(() => {
      if (globalForGame.scoloGame?.service === service) globalForGame.scoloGame = undefined
    })
  }
  const service = await globalForGame.scoloGame.service
  if (sync) startPointSyncWorker(client, sync)
  return service
}

export { GameError } from './types'
export type * from './types'
