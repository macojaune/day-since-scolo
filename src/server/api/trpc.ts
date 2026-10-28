import { initTRPC, TRPCError } from '@trpc/server'
import type { CreateNextContextOptions } from '@trpc/server/adapters/next'
import superjson from 'superjson'
import { ZodError } from 'zod'

import {
  assertLocalRequest,
  assertMutationOrigin,
  getRequestIdentity,
} from '~/server/auth'

export function createTRPCContext({ req }: CreateNextContextOptions) {
  assertLocalRequest(req)
  return { ...getRequestIdentity(req), req }
}

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    }
  },
})

export const createCallerFactory = t.createCallerFactory
export const createTRPCRouter = t.router

export const publicProcedure = t.procedure.use(({ ctx, type, next }) => {
  if (type === 'mutation') assertMutationOrigin(ctx.req)
  return next()
})

export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Connecte-toi pour continuer.' })
  }
  return next({ ctx: { ...ctx, userId: ctx.userId } })
})

export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.isAdmin) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Seul l’administrateur peut déclarer une apparition.',
    })
  }
  return next({ ctx: { ...ctx, isAdmin: true as const } })
})
