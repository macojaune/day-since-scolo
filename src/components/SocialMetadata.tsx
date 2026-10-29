import Head from 'next/head'
import { BRAND_NAME } from '~/utils/brand'
import { SOCIAL_DESCRIPTION, SOCIAL_HEIGHT, SOCIAL_TITLE, SOCIAL_WIDTH, type SocialMetadata as Metadata } from '~/utils/social-preview'

export default function SocialMetadata({ social }: { social: Metadata }) {
  return <Head>
    <link rel="canonical" href={social.pageUrl} />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content={BRAND_NAME} />
    <meta property="og:locale" content="fr_FR" />
    <meta property="og:title" content={`${SOCIAL_TITLE} · ${BRAND_NAME}`} />
    <meta property="og:description" content={SOCIAL_DESCRIPTION} />
    <meta property="og:url" content={social.pageUrl} />
    <meta property="og:image" content={social.imageUrl} />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content={String(SOCIAL_WIDTH)} />
    <meta property="og:image:height" content={String(SOCIAL_HEIGHT)} />
    <meta property="og:image:alt" content={social.imageAlt} />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content={`${SOCIAL_TITLE} · ${BRAND_NAME}`} />
    <meta name="twitter:description" content={SOCIAL_DESCRIPTION} />
    <meta name="twitter:image" content={social.imageUrl} />
    <meta name="twitter:image:alt" content={social.imageAlt} />
  </Head>
}
