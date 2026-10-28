import { createLocalDatabaseClient } from '../src/server/db/index'
import { seedLocalDemo } from '../src/server/game/seed-local'

if (process.env.SCOLO_WALLET_MODE !== 'local') throw new Error('SCOLO_WALLET_MODE=local est requis.')
const client = createLocalDatabaseClient()
try {
  const result = await seedLocalDemo(client)
  const messages = {
    seeded: 'Trois joueurs, trois pronostics et trois apparitions fictifs ajoutés dans la base locale.',
    'already-seeded': 'Les données fictives locales existent déjà. Aucun ajout.',
    'not-empty': 'La base contient déjà des données. Aucun ajout ni remplacement.',
  }
  console.log(messages[result.status])
} finally { client.close() }
