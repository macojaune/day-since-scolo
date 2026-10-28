import { type Config } from 'drizzle-kit'

import { env } from '~/env'

export default {
  schema: './src/server/db/schema.ts',
  ...(env.SCOLO_WALLET_MODE === 'scolo'
    ? { dialect: 'turso', dbCredentials: { url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN! } }
    : { dialect: 'sqlite', dbCredentials: { url: env.DATABASE_URL } }),
  out: './drizzle',
} satisfies Config
