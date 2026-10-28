import { httpBatchLink } from '@trpc/client'
import { createTRPCNext } from '@trpc/next'
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server'
import superjson from 'superjson'

import type { AppRouter } from '~/server/api/root'

function getBaseUrl() {
  return typeof window !== 'undefined' ? '' : (process.env.APP_URL ?? 'http://localhost:3092')
}

export const api = createTRPCNext<AppRouter>({
  transformer: superjson,
  config() {
    return {
      links: [httpBatchLink({
        transformer: superjson,
        url: `${getBaseUrl()}/api/trpc`,
      })],
      queryClientConfig: {
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: true },
          mutations: { retry: false },
        },
      },
    }
  },
  ssr: false,
})

export type RouterInputs = inferRouterInputs<AppRouter>
export type RouterOutputs = inferRouterOutputs<AppRouter>
