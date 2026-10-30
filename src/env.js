import { createEnv } from '@t3-oss/env-nextjs'
import { z } from 'zod'
import { assertDeploymentConfiguration } from './config.js'

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().min(1),
    DATABASE_AUTH_TOKEN: z.string().min(1).optional(),
    SCOLO_WALLET_MODE: z.enum(['local', 'scolo']),
    SCOLO_ENVIRONMENT: z.enum(['local', 'dev', 'prod']).optional(),
    SCOLO_ADMIN_USER_IDS: z.string().default(''),
    APP_URL: z.string().url(),
    CLERK_SECRET_KEY: z.string().regex(/^sk_(test|live)_.+/),
    SCOLO_TWEETS_ENABLED: z.enum(['true', 'false']).default('false'),
    SCOLO_ZIKAK_SYNC_ENABLED: z.enum(['true', 'false']).default('false'),
    ZIKAK_API_ORIGIN: z.string().url().optional(),
    ZIKAK_APPLICATION_ID: z.string().min(1).optional(),
    ZIKAK_INTEGRATION_TOKEN: z.string().min(1).optional(),
    BUFFER_API_KEY: z.string().min(1).optional(),
    BUFFER_CHANNEL_ID: z.string().min(1).optional(),
  },
  client: {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().regex(/^pk_(test|live)_.+/),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_AUTH_TOKEN: process.env.DATABASE_AUTH_TOKEN,
    SCOLO_WALLET_MODE: process.env.SCOLO_WALLET_MODE,
    SCOLO_ENVIRONMENT: process.env.SCOLO_ENVIRONMENT,
    SCOLO_ADMIN_USER_IDS: process.env.SCOLO_ADMIN_USER_IDS,
    APP_URL: process.env.APP_URL,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    SCOLO_TWEETS_ENABLED: process.env.SCOLO_TWEETS_ENABLED,
    SCOLO_ZIKAK_SYNC_ENABLED: process.env.SCOLO_ZIKAK_SYNC_ENABLED,
    ZIKAK_API_ORIGIN: process.env.ZIKAK_API_ORIGIN,
    ZIKAK_APPLICATION_ID: process.env.ZIKAK_APPLICATION_ID,
    ZIKAK_INTEGRATION_TOKEN: process.env.ZIKAK_INTEGRATION_TOKEN,
    BUFFER_API_KEY: process.env.BUFFER_API_KEY,
    BUFFER_CHANNEL_ID: process.env.BUFFER_CHANNEL_ID,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  },
  emptyStringAsUndefined: true,
})

if (typeof window === 'undefined') assertDeploymentConfiguration(env)
