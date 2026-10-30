import type { GetServerSideProps } from 'next'
import { applicationEnvironment } from '~/config.js'
import { env } from '~/env'

// Keep the first prototype's URL useful. The game now lives in the weapon slot.
export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive')
  if (applicationEnvironment(env) !== 'local') return { notFound: true }
  return { redirect: { destination: '/#run', permanent: false } }
}

export default function SandalePage() { return null }
