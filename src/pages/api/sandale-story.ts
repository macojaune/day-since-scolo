import { gameInput } from '~/game/weapons/catalog'
import type { NextApiRequest, NextApiResponse } from 'next'
import { applicationEnvironment } from '~/config.js'
import { env } from '~/env'
import { getAuth } from '@clerk/nextjs/server'
import { assertLocalRequest } from '~/server/auth'
import { getArcadeService } from '~/server/arcade/runtime'
import { renderArcadeStory } from '~/server/arcade/story-image'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (!['GET', 'HEAD'].includes(req.method ?? '')) { res.setHeader('Allow', 'GET, HEAD'); return res.status(405).end() }
  try {
    assertLocalRequest(req)
    const { userId } = getAuth(req)
    const game = gameInput.parse(req.query.game ?? 'sandale')
    const service = await getArcadeService(game)
    const suffix = game === 'sandale' ? '' : `_${game}`
    const records = req.query.view === 'records'
    const [board, current] = await Promise.all([service.standings(userId, records ? undefined : req.cookies[`scolo_arcade_latest${suffix}`] ?? req.cookies[`scolo_arcade_pending${suffix}`], 0), records ? null : service.pending(req.cookies[`scolo_arcade_pending${suffix}`], userId)])
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Content-Disposition', 'attachment; filename="bet-a-milpat-classement-story.png"')
    if (req.method === 'HEAD') return res.status(200).end()
    const bytes = await renderArcadeStory(board, current && !current.otherAccount ? current : undefined, applicationEnvironment(env) !== 'prod', game)
    return res.status(200).send(bytes)
  } catch { return res.status(503).json({ error: 'L’image est indisponible. Réessaie dans un instant.' }) }
}
