import GamePage from '~/components/GamePage'
import SocialMetadata from '~/components/SocialMetadata'
import { getSocialPageProps, type SocialPageProps } from '~/server/social/preview-metadata'

export const getServerSideProps = getSocialPageProps

// Keep the shared local preview URL on the direction Marvin selected.
export default function Explorations({ social }: SocialPageProps) {
  return <><SocialMetadata social={social} /><GamePage /></>
}
