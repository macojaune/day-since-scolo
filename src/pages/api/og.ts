import type { NextApiRequest, NextApiResponse } from 'next'
import { env } from '~/env'
import { getDatabaseClient } from '~/server/db'
import { readSocialCardData, unavailableSocialCardData } from '~/server/social/preview-data'
import { renderSocialImage } from '~/server/social/preview-image'

export default async function handler(request: NextApiRequest, response: NextApiResponse) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD')
    response.setHeader('Cache-Control', 'no-store')
    return response.status(405).end()
  }
  if (request.method === 'HEAD') {
    response.setHeader('Content-Type', 'image/png')
    response.setHeader('Cache-Control', 'no-store')
    return response.status(200).end()
  }
  let data = unavailableSocialCardData()
  let available = false
  try {
    data = await readSocialCardData(getDatabaseClient(env), env.SCOLO_WALLET_MODE)
    available = true
  } catch { /* Render the invitation without inventing a count when the database is unavailable. */ }
  try {
    const image = await renderSocialImage(data)
    response.setHeader('Content-Type', 'image/png')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cache-Control', available ? 'public, max-age=60, s-maxage=60, stale-while-revalidate=300' : 'no-store')
    return response.status(200).send(image)
  } catch {
    response.setHeader('Cache-Control', 'no-store')
    return response.status(503).end()
  }
}
