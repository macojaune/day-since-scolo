import { createLocalDatabaseClient } from '../src/server/db/index'
import { createGameService } from '../src/server/game/service'

if (process.env.SCOLO_WALLET_MODE !== 'local') throw new Error('SCOLO_WALLET_MODE=local est requis.')
const client = createLocalDatabaseClient()
try {
  await createGameService(client)
  console.log('Base SQLite locale prête. Schéma historique conservé, aucune donnée distante modifiée.')
} finally { client.close() }
