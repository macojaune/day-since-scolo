import type { Client } from '@libsql/client'
import { env } from '../../env.js'
import { getDatabaseClient } from '../db'
import { createArcadeService } from './service'

const services = new WeakMap<Client, ReturnType<typeof createArcadeService>>()
export function getArcadeService() {
  const client = getDatabaseClient(env)
  let promise = services.get(client)
  if (!promise) {
    promise = createArcadeService(client, undefined, { allowHosted: env.SCOLO_WALLET_MODE === 'scolo' })
    services.set(client, promise)
    void promise.catch(() => services.delete(client))
  }
  return promise
}
