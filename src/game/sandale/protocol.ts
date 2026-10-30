import { z } from 'zod'

export const finishInput = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  elapsedMs: z.number().finite().positive(),
  actions: z.array(z.object({ at: z.number().finite().nonnegative(), bugId: z.number().int().positive().optional() })).max(10000),
})
export type FinishedRun = z.infer<typeof finishInput>
export type ScoreReceipt = { id: string; elapsedMs: number; crushed: number; claimed: boolean }
