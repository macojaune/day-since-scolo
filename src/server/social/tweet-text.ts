import twitterText from 'twitter-text'
import { formatDistance } from '../../utils/game-format'

export const SCOLO_URL = 'https://scolo.marvinl.com'
export const tweetLength = (text: string) => twitterText.parseTweet(text).weightedLength
export const validTweet = (text: string) => text.trim().length > 0 && twitterText.parseTweet(text).valid

/** Always keep the full facts and link; switch to a compact wording instead of cutting text. */
export function fitTweet(...variants: string[]): string {
  const text = variants.map(value => value.normalize('NFC')).find(validTweet)
  if (!text) throw new Error('Tweet exceeds the X character limit')
  return text
}

export function runDuration(since: number | null, now: number): string | null {
  return since !== null && Number.isFinite(since) && since <= now ? formatDistance(now - since) : null
}

export interface ParticipationSnapshot {
  participants: number; predictions: number; pot: number; since: number | null; now: number
}
export function buildParticipationTweet(input: ParticipationSnapshot): string {
  const duration = runDuration(input.since, input.now)
  const run = duration ? `${duration} sans croiser de scolo. Le run tient encore.` : 'Durée du run inconnue. La manche est ouverte.'
  return fitTweet(
    `${run}\n\nOn est déjà à ${input.participants} joueurs et ${input.predictions} pronostics, pour une cagnotte de ${input.pot} zikak.\n\nViens parier des zikak sur mon malheur ${SCOLO_URL}`,
    `${duration ? `${duration} sans scolo.` : 'Durée du run inconnue.'}\n${input.participants} joueurs, ${input.predictions} pronostics et ${input.pot} zikak dans la cagnotte.\n\nViens parier des zikak sur mon malheur ${SCOLO_URL}`,
  )
}
