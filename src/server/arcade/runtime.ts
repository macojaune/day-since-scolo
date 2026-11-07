import type { ArcadeGame } from '../../game/weapons/catalog'
import type { Client } from '@libsql/client'
import { env } from '../../env.js'
import { getDatabaseClient } from '../db'
import { createArcadeService } from './service'

const services = new WeakMap<Client, Map<ArcadeGame, ReturnType<typeof createArcadeService>>>()
export function getArcadeService(game: ArcadeGame = 'sandale') {
  const client = getDatabaseClient(env)
  let games = services.get(client)
  if (!games) { games = new Map(); services.set(client, games) }
  let promise = games.get(game)
  if (!promise) {
    promise = createArcadeService(client, undefined, { game, allowHosted: env.SCOLO_WALLET_MODE === 'scolo' })
    games.set(game, promise)
    void promise.catch(() => games.delete(game))
  }
  return promise
}
