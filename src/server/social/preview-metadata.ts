import type { GetServerSideProps } from 'next'
import { env } from '~/env'
import { getDatabaseClient } from '../db'
import { readSocialCardData, socialMetadata, unavailableSocialCardData, type SocialMetadata } from './preview-data'

export type SocialPageProps = { social: SocialMetadata }

export const getSocialPageProps: GetServerSideProps<SocialPageProps> = async () => {
  let data = unavailableSocialCardData()
  try { data = await readSocialCardData(getDatabaseClient(env), env.SCOLO_WALLET_MODE) }
  catch { /* Metadata must remain available even when the game is temporarily unavailable. */ }
  return { props: { social: socialMetadata(data, env.APP_URL) } }
}
