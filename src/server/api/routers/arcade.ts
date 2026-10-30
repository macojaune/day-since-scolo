import { createHash } from 'node:crypto'
import { clerkClient } from '@clerk/nextjs/server'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { isIP } from 'node:net'
import { applicationEnvironment } from '~/config.js'
import { env } from '~/env'
import { finishInput } from '~/game/sandale/protocol'
import { ArcadeError } from '~/server/arcade/service'
import { getArcadeService as service } from '~/server/arcade/runtime'
import { createTRPCRouter, protectedProcedure, publicProcedure } from '../trpc'
import type { NextApiRequest, NextApiResponse } from 'next'

const COOKIE = 'scolo_arcade_pending'
const arcadePublic = publicProcedure.use(({ ctx, next }) => {
  ctx.res?.setHeader('Cache-Control', 'private, no-store')
  return next()
})
const arcadeProtected = protectedProcedure.use(({ ctx, next }) => {
  ctx.res?.setHeader('Cache-Control', 'private, no-store')
  return next()
})
async function handle<T>(action: () => Promise<T>): Promise<T> {
  try { return await action() } catch (error) {
    if (error instanceof ArcadeError) throw new TRPCError({ code: error.code, message: error.message })
    if (error instanceof TRPCError) throw error
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Le classement ne répond pas. Ton score reste en attente ; réessaie.', cause: error })
  }
}
function viewer(actual: string | null, expected: string | null) {
  if (actual !== expected) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Ta session a changé. Rouvre le classement.' })
}
function cookie(req: NextApiRequest) { return req.cookies?.[COOKIE] }
function setCookie(res: NextApiResponse | undefined, token: string, name = COOKIE) {
  if (!res) return
  const existing = res.getHeader('Set-Cookie')
  const values = Array.isArray(existing) ? existing.map(String) : existing ? [String(existing)] : []
  res.setHeader('Set-Cookie', [...values.filter(value => !value.startsWith(`${name}=`)), `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${applicationEnvironment(env) === 'local' ? '' : '; Secure'}`])
}
async function remember(req: NextApiRequest, res: NextApiResponse | undefined, token: string, userId: string | null) {
  let current = await (await service()).pending(cookie(req), userId)
  if (current?.otherAccount || current?.claimed) current = null
  const next = await (await service()).pending(token, userId)
  if (next && (!current || next.elapsedMs > current.elapsedMs || (next.elapsedMs === current.elapsedMs && next.crushed >= current.crushed))) setCookie(res, token)
}
const viewerInput = z.object({ viewerId: z.string().nullable() })
export const arcadeRouter = createTRPCRouter({
  start: arcadePublic.mutation(({ ctx }) => handle(async () => (await service()).start(ctx.userId,
    createHash('sha256').update(ctx.userId ?? (typeof ctx.req.headers['cf-connecting-ip'] === 'string' && isIP(ctx.req.headers['cf-connecting-ip']) ? ctx.req.headers['cf-connecting-ip'] : ctx.req.socket?.remoteAddress ?? 'loopback')).digest('hex')))),
  finish: arcadePublic.input(finishInput).mutation(({ ctx, input }) => handle(async () => {
    const score = await (await service()).finish(input, ctx.userId)
    await remember(ctx.req, ctx.res, input.token, ctx.userId)
    setCookie(ctx.res, input.token, 'scolo_arcade_latest')
    return score
  })),
  restore: arcadePublic.input(z.object({ token: finishInput.shape.token })).mutation(({ ctx, input }) => handle(async () => {
    const score = await (await service()).pending(input.token, ctx.userId)
    if (score && !score.otherAccount) {
      await remember(ctx.req, ctx.res, input.token, ctx.userId)
      setCookie(ctx.res, input.token, 'scolo_arcade_latest')
    }
    return score
  })),
  pending: arcadePublic.input(viewerInput).query(({ ctx, input }) => handle(async () => {
    viewer(ctx.userId, input.viewerId)
    return (await service()).pending(cookie(ctx.req), ctx.userId)
  })),
  leaderboard: arcadePublic.input(viewerInput).query(({ ctx, input }) => handle(async () => {
    viewer(ctx.userId, input.viewerId)
    return (await service()).leaderboard(ctx.userId)
  })),
  standings: arcadePublic.input(viewerInput.extend({ offset: z.number().int().min(0).max(10000000).optional() })).query(({ ctx, input }) => handle(async () => {
    viewer(ctx.userId, input.viewerId)
    return (await service()).standings(ctx.userId, ctx.req.cookies?.scolo_arcade_latest ?? cookie(ctx.req), input.offset)
  })),
  claim: arcadeProtected.input(z.object({ viewerId: z.string().min(1) })).mutation(({ ctx, input }) => handle(async () => {
    viewer(ctx.userId, input.viewerId)
    const token = cookie(ctx.req)
    if (!token) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Aucun score en attente dans ce navigateur.' })
    const user = await (await clerkClient()).users.getUser(ctx.userId)
    return (await service()).claim(token, ctx.userId, user.username ?? 'Joueur')
  })),
  reward: arcadeProtected.input(z.object({ viewerId: z.string().min(1) })).mutation(({ ctx, input }) => handle(async () => {
    viewer(ctx.userId, input.viewerId)
    const user = await (await clerkClient()).users.getUser(ctx.userId)
    return (await service()).reward(ctx.userId, user.username ?? 'Joueur')
  })),
})
