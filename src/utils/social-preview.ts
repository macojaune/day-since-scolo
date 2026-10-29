export const SOCIAL_TITLE = 'Parie sur la prochaine rencontre'
export const SOCIAL_DESCRIPTION = 'Choisis la date du prochain scolopendre chez Marvin et joue avec des Zikak fictifs.'
export const SOCIAL_WIDTH = 1200
export const SOCIAL_HEIGHT = 630
export const SOCIAL_IMAGE_VERSION = 'bet-a-milpat-v1'
export type SocialWeapon = 'sandale' | 'coutelas' | 'digrain' | 'capes'
export interface SocialCardData {
  predictionCount: number | null
  daysWithoutAppearance: number | null
  weapon: SocialWeapon | null
  weaponLabel: string
}
export interface SocialMetadata {
  imageUrl: string
  pageUrl: string
  imageAlt: string
}
