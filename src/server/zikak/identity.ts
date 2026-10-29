import { PointSyncError, readProviderBody, type SyncConfiguration } from './outbox'

export interface SubjectClaims {
  subject_id: string
  display_name?: string
  username?: string
  emails: { address: string; verified: boolean; verification_source: 'clerk' }[]
  identities: { source_type: string; external_id: string }[]
}
export interface SubjectResolution {
  resolution_id: string
  application_id: string
  subject_id: string
  status: 'linked' | 'pending' | 'new'
  can_sync_points: boolean
  reason: string
  revision: number
}

/** Only a backend Clerk response may populate these claims; never a request body. */
export function claimsFromClerk(
  subjectId: string,
  user: {
    id: string
    username: string | null
    emailAddresses: { emailAddress: string; verification: { status: string | null } | null }[]
  }
): SubjectClaims {
  return {
    subject_id: subjectId,
    ...(user.username ? { username: user.username, display_name: user.username } : {}),
    emails: user.emailAddresses.slice(0, 10).map((email) => ({
      address: email.emailAddress,
      verified: email.verification?.status === 'verified',
      verification_source: 'clerk' as const,
    })),
    // A chosen username is a hint. It is not an authenticated Instagram/TikTok identity.
    identities: [],
  }
}

export function createSubjectResolver(config: SyncConfiguration, fetcher: typeof fetch = fetch) {
  async function request(subjectId: string, claims?: SubjectClaims): Promise<SubjectResolution | null> {
    let response: Response
    try {
      response = await fetcher(
        `${config.origin}/api/integrations/v1/subjects/${claims ? 'resolve' : encodeURIComponent(subjectId)}`,
        {
          method: claims ? 'POST' : 'GET',
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
          headers: {
            Authorization: `Bearer ${config.token}`,
            ...(claims ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(claims ? { body: JSON.stringify(claims) } : {}),
        }
      )
    } catch {
      throw new PointSyncError('IDENTITY_NETWORK_OR_TIMEOUT', true)
    }
    if (!claims && response.status === 404) {
      await response.body?.cancel()
      return null
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new PointSyncError(
        `IDENTITY_HTTP_${response.status}`,
        response.status >= 500 || response.status === 408 || response.status === 429
      )
    }
    try {
      const text = await readProviderBody(response)
      const result = JSON.parse(text) as SubjectResolution
      if (
        result.application_id !== config.applicationId ||
        result.subject_id !== subjectId ||
        typeof result.resolution_id !== 'string' ||
        !result.resolution_id ||
        result.resolution_id.length > 128 ||
        !Number.isSafeInteger(result.revision) ||
        result.revision < 1 ||
        !['linked', 'new', 'pending'].includes(result.status) ||
        typeof result.reason !== 'string' ||
        result.reason.length > 256 ||
        result.can_sync_points !== (result.status === 'linked' || result.status === 'new')
      )
        throw new Error('Invalid resolution')
      return result
    } catch {
      throw new PointSyncError('INVALID_IDENTITY_RESOLUTION', true)
    }
  }
  return {
    resolve: (claims: SubjectClaims) => request(claims.subject_id, claims),
    get: (subjectId: string) => request(subjectId),
  }
}
