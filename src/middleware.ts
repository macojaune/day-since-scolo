import { clerkMiddleware } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { env } from './env.js'
import { applicationOrigin, isAllowedApplicationHost } from './config.js'

export default clerkMiddleware((_auth, request) => {
  if (!isAllowedApplicationHost(request.headers.get('host'), env)) {
    return NextResponse.json({ error: 'Adresse non autorisée pour cet environnement.' }, { status: 403 })
  }
}, {
  authorizedParties: [applicationOrigin(env)],
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
