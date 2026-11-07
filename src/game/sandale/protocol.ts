import { z } from 'zod'

export const finishInput = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  elapsedMs: z.number().finite().positive().max(3600000),
  actions: z.array(z.object({ at: z.number().finite().nonnegative(), bugId: z.number().int().positive().optional(), x: z.number().finite().min(0).max(320).optional(), fire: z.boolean().optional(), angle: z.number().finite().min(15).max(165).optional(), power: z.number().finite().min(10).max(100).optional() })).max(30000),
})
export type FinishedRun = z.infer<typeof finishInput>
export type ScoreReceipt = { id: string; elapsedMs: number; crushed: number; claimed: boolean; points?: number }
