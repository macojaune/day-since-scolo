import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { clerkClient } from '@clerk/nextjs/server'
import { adminProcedure, createTRPCRouter, protectedProcedure, publicProcedure } from '~/server/api/trpc'
import { GameError, getGameService } from '~/server/game'
import { publishAppearanceIfEnabled } from '~/server/social/appearance-publication'
import { flushPointSync, getPointSyncStatus } from '~/server/zikak/runtime'

const settlementInput = z.object({
  roundId: z.string().min(1),
  observedAt: z.date(),
  tool: z.enum(['sandale', 'coutelas', 'digrain', 'capes']),
})

const viewerInput = z.object({ viewerId: z.string().min(1) })
function assertViewer(actual: string, expected: string) {
  if (actual !== expected) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Ta session a changé. Recharge la page pour continuer.' })
}

async function handleGame<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation() }
  catch (error) {
    if (error instanceof TRPCError) throw error
    if (error instanceof GameError) {
      throw new TRPCError({ code: error.code === 'CONFIGURATION_ERROR' ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST', message: error.message, cause: error })
    }
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Le jeu ne répond pas. Réessaie dans un instant.', cause: error })
  }
}

export const appRouter = createTRPCRouter({
  game: publicProcedure.query(() => handleGame(async () => (await getGameService()).getPublicGame())),
  join: protectedProcedure.input(viewerInput).mutation(({ ctx, input }) => handleGame(async () => {
    assertViewer(ctx.userId, input.viewerId)
    const user = await (await clerkClient()).users.getUser(ctx.userId)
    return (await getGameService()).ensurePlayer({ userId: ctx.userId, displayName: user.username ?? undefined })
  })),
  me: protectedProcedure.input(viewerInput).query(({ ctx, input }) => handleGame(async () => {
    assertViewer(ctx.userId, input.viewerId)
    try { return { ...(await (await getGameService()).getPlayerGame(ctx.userId)), isAdmin: ctx.isAdmin, registered: true } }
    catch (error) {
      if (error instanceof GameError && error.code === 'PLAYER_NOT_FOUND') return { balance: 0, committed: 0, predictions: [], isAdmin: ctx.isAdmin, registered: false }
      throw error
    }
  })),
  bet: protectedProcedure.input(z.object({
    viewerId: z.string().min(1),
    roundId: z.string().min(1), predictedAt: z.date(),
    stake: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    idempotencyKey: z.string().min(8).max(120),
  })).mutation(({ ctx, input }) => handleGame(async () => {
    assertViewer(ctx.userId, input.viewerId)
    return (await getGameService()).placePrediction({ ...input, userId: ctx.userId })
  })),
  addHistoricalAppearance: adminProcedure.input(settlementInput.omit({ roundId: true }).extend({
    idempotencyKey: z.string().min(8).max(128),
  })).mutation(({ ctx, input }) => handleGame(async () => (await getGameService()).addHistoricalAppearance({ ...input, actorUserId: ctx.userId }))),
  previewSettlement: adminProcedure.input(settlementInput).mutation(({ input }) => handleGame(async () => (await getGameService()).previewSettlement(input))),
  pointSyncStatus: adminProcedure.query(() => handleGame(async () => { await getGameService(); return getPointSyncStatus() })),
  retryPointSync: adminProcedure.mutation(() => handleGame(async () => { await getGameService(); return flushPointSync(true) })),
  settleRound: adminProcedure.input(settlementInput).mutation(({ input }) => handleGame(async () => {
    const result = await (await getGameService()).settleRound(input)
    const publication = result.appearanceId ? await publishAppearanceIfEnabled(result.appearanceId) : undefined
    // The committed settlement is successful even when the remote sync is unavailable.
    const pointSync = await flushPointSync().catch(() => null)
    return { ...result, publication, pointSync }
  })),
})
