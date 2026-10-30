import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createBufferPublisher } from '../src/server/social/buffer'
import { TweetPublicationError } from '../src/server/social/publication-error'

/** Only GraphQL queries. Never creates a post, updates the database or enables publication. */
export async function checkBufferConnection(config: { apiKey: string; channelId: string }, postId?: string) {
  const publisher = createBufferPublisher(config)
  const channel = await publisher.checkChannel()
  return { ...channel, publishesMessages: false as const, ...(postId ? { post: await publisher.getPost(postId) } : {}) }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--post-id' || !args[1]?.trim())) {
    throw new Error('Usage : buffer:check [--post-id <identifiant Buffer>]')
  }
  const apiKey = process.env.BUFFER_API_KEY
  const channelId = process.env.BUFFER_CHANNEL_ID
  if (!apiKey || !channelId) throw new Error('BUFFER_API_KEY et BUFFER_CHANNEL_ID sont requis côté serveur.')
  console.log(JSON.stringify(await checkBufferConnection({ apiKey, channelId }, args[1]), null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch(error => {
    console.error(error instanceof TweetPublicationError ? error.code : error instanceof Error ? error.message : 'Vérification Buffer interrompue.')
    process.exitCode = 1
  })
}
