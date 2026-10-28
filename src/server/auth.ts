import { getAuth } from '@clerk/nextjs/server'
import { TRPCError } from '@trpc/server'
import type { NextApiRequest } from 'next'

import { env } from '~/env'
import { isAllowedApplicationHost, isSameOriginMutation, isConfiguredAdmin } from '../config.js'

export { isLoopbackHost } from '../config.js'

/** Reject hosts outside the configured environment before processing any identity. */
export function assertLocalRequest(req: NextApiRequest): void {
  if (!isAllowedApplicationHost(req.headers.host, env)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Cette adresse ne correspond pas à cet environnement Scolo.',
    })
  }
}

/** Only browser requests from this exact application may change game state. */
export function assertMutationOrigin(req: NextApiRequest): void {
  if (!isSameOriginMutation({ host: req.headers.host, origin: req.headers.origin, fetchSite: req.headers['sec-fetch-site'] }, env)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Effectue cette action depuis Scolo.',
    })
  }
}

export function isAdminUser(userId: string | null): boolean {
  return isConfiguredAdmin(userId, env.SCOLO_ADMIN_USER_IDS)
}

export function getRequestIdentity(req: NextApiRequest) {
  const { userId } = getAuth(req)
  return { userId, isAdmin: isAdminUser(userId) }
}
