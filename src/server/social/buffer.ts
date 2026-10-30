import { validTweet } from './tweet-text'
import { TweetPublicationError } from './publication-error'

export interface BufferConfiguration { apiKey: string; channelId: string }
export interface BufferPost {
  bufferPostId: string
  channelId: string
  status: 'queued' | 'sent' | 'failed'
  tweetId?: string
}

const fields = 'id channelId status externalLink'
const createPost = `mutation ScoloAppearance($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { ${fields} } }
    ... on MutationError { message }
  }
}`
const readPost = `query ScoloPublication($input: PostInput!) { post(input: $input) { ${fields} } }`
const channelQuery = `query ScoloChannel($input: ChannelInput!) {
  channel(input: $input) { id service isDisconnected isLocked isQueuePaused }
}`

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function parsePost(value: unknown, channelId: string): BufferPost {
  const post = record(value)
  if (!post || typeof post.id !== 'string' || !post.id.trim() || post.channelId !== channelId ||
    !['scheduled', 'sending', 'sent', 'error', 'draft', 'needs_approval'].includes(String(post.status))) {
    throw new TweetPublicationError('unknown', 'BUFFER_INVALID_RESPONSE')
  }
  let tweetId: string | undefined
  if (post.status === 'sent') {
    try {
      const url = new URL(String(post.externalLink))
      const match = /^\/(?:[^/]+|i\/web)\/status\/(\d+)\/?$/.exec(url.pathname)
      if (url.protocol === 'https:' && ['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com'].includes(url.hostname) &&
        !url.username && !url.password && !url.port) tweetId = match?.[1]
    } catch { /* A sent response without its X reference needs reconciliation. */ }
  }
  return {
    bufferPostId: post.id, channelId,
    status: post.status === 'sent' ? tweetId ? 'sent' : 'queued' : ['error', 'draft', 'needs_approval'].includes(String(post.status)) ? 'failed' : 'queued',
    ...(tweetId ? { tweetId } : {}),
  }
}

/** No mutation retries: a lost response may hide a successfully created Buffer post. */
export function createBufferPublisher(config: BufferConfiguration, options: { fetch?: typeof fetch; timeoutMs?: number } = {}) {
  const request = options.fetch ?? fetch
  async function query(document: string, input: unknown): Promise<Record<string, unknown>> {
    if (!config.apiKey || /\s/.test(config.apiKey) || !config.channelId || /\s/.test(config.channelId)) {
      throw new TweetPublicationError('failed', 'BUFFER_CONFIGURATION')
    }
    let response: Response
    try {
      response = await request('https://api.buffer.com', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: document, variables: { input } }),
        redirect: 'error', signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      })
    } catch { throw new TweetPublicationError('unknown', 'BUFFER_NETWORK_OUTCOME_UNKNOWN') }
    if (!response.ok) throw new TweetPublicationError(response.status >= 400 && response.status < 500 ? 'failed' : 'unknown', `BUFFER_HTTP_${response.status}`)
    let payload: Record<string, unknown> | undefined
    try { payload = record(await response.json()) } catch { /* Handled below without logging provider data. */ }
    if (!payload || (Array.isArray(payload.errors) && payload.errors.length) || !record(payload.data)) {
      throw new TweetPublicationError('unknown', 'BUFFER_INVALID_RESPONSE')
    }
    return record(payload.data)!
  }
  async function checkChannel() {
    const channel = record((await query(channelQuery, { id: config.channelId })).channel)
    if (!channel || channel.id !== config.channelId || channel.service !== 'twitter' ||
      channel.isDisconnected !== false || channel.isLocked !== false || channel.isQueuePaused !== false) {
      throw new TweetPublicationError('failed', 'BUFFER_CHANNEL_UNAVAILABLE')
    }
    return { channelId: config.channelId, service: 'twitter' as const, connected: true as const }
  }
  return {
    checkChannel,
    async publish(text: string): Promise<BufferPost> {
      if (!validTweet(text)) throw new TweetPublicationError('failed', 'BUFFER_INVALID_TEXT')
      // Check the configured destination before each creation. A wrong network must never receive a post.
      try { await checkChannel() } catch (error) {
        throw new TweetPublicationError('failed', error instanceof TweetPublicationError ? error.code : 'BUFFER_CHANNEL_UNAVAILABLE')
      }
      const result = record((await query(createPost, {
        text, channelId: config.channelId, schedulingType: 'automatic', mode: 'shareNow',
        assets: [], needsApproval: false, saveToDraft: false,
      })).createPost)
      if (!result || typeof result.__typename !== 'string') throw new TweetPublicationError('unknown', 'BUFFER_INVALID_RESPONSE')
      if (result.__typename !== 'PostActionSuccess') throw new TweetPublicationError('failed', 'BUFFER_POST_REJECTED')
      return parsePost(result.post, config.channelId)
    },
    async getPost(id: string): Promise<BufferPost> {
      const post = parsePost((await query(readPost, { id })).post, config.channelId)
      if (post.bufferPostId !== id) throw new TweetPublicationError('unknown', 'BUFFER_INVALID_RESPONSE')
      return post
    },
  }
}
