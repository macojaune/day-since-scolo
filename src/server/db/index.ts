import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createClient, type Client } from '@libsql/client'
import { assertDatabaseConfiguration, type DatabaseConfiguration } from '../../config.js'

export type { DatabaseConfiguration } from '../../config.js'

/** Local scripts cannot open a remote database, even with production variables loaded. */
export function createLocalDatabaseClient(url = process.env.DATABASE_URL ?? 'file:./.local/scolo.db'): Client {
  assertDatabaseConfiguration({ SCOLO_WALLET_MODE: 'local', DATABASE_URL: url })
  mkdirSync(dirname(resolve(url.slice(5))), { recursive: true })
  return createClient({ url })
}

export function createDatabaseClient(config: DatabaseConfiguration): Client {
  assertDatabaseConfiguration(config)
  return config.SCOLO_WALLET_MODE === 'local'
    ? createLocalDatabaseClient(config.DATABASE_URL)
    : createClient({ url: config.DATABASE_URL, authToken: config.DATABASE_AUTH_TOKEN })
}

const globalForDb = globalThis as unknown as {
  scoloDatabase?: { config: DatabaseConfiguration; client: Client }
}

/** Imports and builds perform no database I/O. Runtime requests initialize the client. */
export function getDatabaseClient(config: DatabaseConfiguration): Client {
  const cached = globalForDb.scoloDatabase
  if (cached && !cached.client.closed &&
    cached.config.SCOLO_WALLET_MODE === config.SCOLO_WALLET_MODE &&
    cached.config.DATABASE_URL === config.DATABASE_URL &&
    cached.config.DATABASE_AUTH_TOKEN === config.DATABASE_AUTH_TOKEN) return cached.client
  const client = createDatabaseClient(config)
  globalForDb.scoloDatabase = {
    config: {
      SCOLO_WALLET_MODE: config.SCOLO_WALLET_MODE,
      DATABASE_URL: config.DATABASE_URL,
      DATABASE_AUTH_TOKEN: config.DATABASE_AUTH_TOKEN,
    },
    client,
  }
  return client
}
