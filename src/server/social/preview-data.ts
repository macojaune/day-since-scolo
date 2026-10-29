import { createHash } from 'node:crypto'
import type { Client } from '@libsql/client'
import { GameService } from '../game/service'
import type { PublicGame, WalletMode } from '../game/types'
import { SOCIAL_IMAGE_VERSION, SOCIAL_TITLE, type SocialCardData, type SocialMetadata, type SocialWeapon } from '../../utils/social-preview'
export type { SocialCardData, SocialMetadata } from '../../utils/social-preview'

const weapons = {
  sandale: 'Sandale', coutelas: 'Coutelas', digrain: 'Digrain', capes: 'CAPES',
} as const
export function socialCardData(game: PublicGame, now = new Date()): SocialCardData {
  const tool = game.lastAppearance?.tool ?? ''
  const weapon = Object.hasOwn(weapons, tool) ? tool as SocialWeapon : null
  const elapsed = now.getTime() - new Date(game.lastAppearance?.occurredAt ?? '').getTime()
  return {
    predictionCount: game.round.predictionCount,
    daysWithoutAppearance: Number.isFinite(elapsed) ? Math.max(0, Math.floor(elapsed / 86400000)) : null,
    weapon,
    weaponLabel: weapon ? weapons[weapon] : 'Non renseignée',
  }
}

export function unavailableSocialCardData(): SocialCardData {
  return { predictionCount: null, daysWithoutAppearance: null, weapon: null, weaponLabel: 'Non renseignée' }
}

/** Reuse the public game's counting rules without initialize(), writes or migrations. */
export async function readSocialCardData(client: Client, mode: WalletMode, now = new Date()) {
  const game = await new GameService(client, { walletMode: mode }).getPublicGame()
  return socialCardData(game, now)
}

export function socialCardVersion(data: SocialCardData) {
  return createHash('sha256').update(`${SOCIAL_IMAGE_VERSION}:${JSON.stringify(data)}`).digest('hex').slice(0, 16)
}

export function socialImageAlt(data: SocialCardData) {
  const bets = data.predictionCount === null
    ? 'Parie avec des Zikak fictifs.'
    : `${data.predictionCount} pari${data.predictionCount === 1 ? '' : 's'} validé${data.predictionCount === 1 ? '' : 's'} pour la manche en cours.`
  return `${SOCIAL_TITLE}. ${bets} Dernière arme du crime : ${data.weaponLabel}.`
}

export function socialMetadata(data: SocialCardData, appUrl: string): SocialMetadata {
  const origin = new URL(appUrl).origin
  return {
    pageUrl: `${origin}/`,
    imageUrl: `${origin}/api/og?v=${socialCardVersion(data)}`,
    imageAlt: socialImageAlt(data),
  }
}
