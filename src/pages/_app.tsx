import { ClerkProvider } from '@clerk/nextjs'
import { frFR } from '@clerk/localizations'
import { GeistSans } from 'geist/font/sans'
import type { AppType } from 'next/app'

import { env } from '~/env'
import { api } from '~/utils/api'
import '@daypicker/react/style.css'
import '~/styles/globals.css'

const MyApp: AppType = ({ Component, pageProps }) => (
  <ClerkProvider
    {...pageProps}
    publishableKey={env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
    localization={frFR}
    signInUrl="/sign-in"
    signUpUrl="/sign-up"
    signInFallbackRedirectUrl="/"
    signUpFallbackRedirectUrl="/"
  >
    <div className={GeistSans.className}>
      <Component {...pageProps} />
    </div>
  </ClerkProvider>
)

export default api.withTRPC(MyApp)
