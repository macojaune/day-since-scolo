import GamePage from '~/components/GamePage'
import SocialMetadata from '~/components/SocialMetadata'
import { getSocialPageProps, type SocialPageProps } from '~/server/social/preview-metadata'

export const getServerSideProps = getSocialPageProps

export default function Home({ social }: SocialPageProps) {
  return <><SocialMetadata social={social} /><GamePage /></>
}
