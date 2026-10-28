import { createHmac, randomBytes } from 'node:crypto'

export interface TwitterCredentials {
  appKey: string
  appSecret: string
  accessToken: string
  accessSecret: string
}

const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)

/** OAuth 1.0a user context. JSON request bodies are not OAuth signature parameters. */
export function twitterAuthorization(method: 'GET' | 'POST', target: string, credentials: TwitterCredentials, options: { nonce?: string; timestamp?: number } = {}) {
  const url = new URL(target)
  const oauth: Record<string, string> = {
    oauth_consumer_key: credentials.appKey,
    oauth_token: credentials.accessToken,
    oauth_nonce: options.nonce ?? randomBytes(24).toString('hex'),
    oauth_timestamp: String(options.timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_version: '1.0',
  }
  const pairs = [...url.searchParams.entries(), ...Object.entries(oauth)].map(([key, value]) => [encode(key!), encode(value!)] as const)
  pairs.sort(([a, av], [b, bv]) => a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0)
  const normalized = pairs.map(([key, value]) => `${key}=${value}`).join('&')
  const base = [method, encode(`${url.origin}${url.pathname}`), encode(normalized)].join('&')
  oauth.oauth_signature = createHmac('sha1', `${encode(credentials.appSecret)}&${encode(credentials.accessSecret)}`).update(base).digest('base64')
  return `OAuth ${Object.entries(oauth).sort(([a], [b]) => a < b ? -1 : 1).map(([key, value]) => `${encode(key)}="${encode(value)}"`).join(', ')}`
}

export class TweetPublicationError extends Error {
  constructor(public readonly outcome: 'failed' | 'unknown', public readonly code: string) {
    super(code)
    this.name = 'TweetPublicationError'
  }
}

/** This adapter has no automatic retries: a lost response may hide a successful post. */
export function createTwitterPublisher(credentials: TwitterCredentials, options: { fetch?: typeof fetch; timeoutMs?: number } = {}) {
  const request = options.fetch ?? fetch
  return async (text: string): Promise<{ id: string }> => {
    if (Object.values(credentials).some(value => !value || /\s/.test(value))) {
      throw new TweetPublicationError('failed', 'TWITTER_CONFIGURATION')
    }
    if (!text.trim() || Array.from(text).length > 280) throw new TweetPublicationError('failed', 'TWITTER_INVALID_TEXT')
    const target = 'https://api.x.com/2/tweets'
    let response: Response
    try {
      response = await request(target, {
        method: 'POST',
        headers: { Authorization: twitterAuthorization('POST', target, credentials), 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      })
    } catch {
      throw new TweetPublicationError('unknown', 'TWITTER_NETWORK_OUTCOME_UNKNOWN')
    }
    if (!response.ok) {
      // 4xx responses explicitly reject the request. A server failure may happen after creation.
      throw new TweetPublicationError(response.status >= 400 && response.status < 500 ? 'failed' : 'unknown', `TWITTER_HTTP_${response.status}`)
    }
    let payload: unknown
    try { payload = await response.json() } catch { throw new TweetPublicationError('unknown', 'TWITTER_INVALID_RESPONSE') }
    const id = (payload as { data?: { id?: unknown } } | null)?.data?.id
    if (typeof id !== 'string' || !/^\d+$/.test(id)) throw new TweetPublicationError('unknown', 'TWITTER_INVALID_RESPONSE')
    return { id }
  }
}
