import { SignIn } from '@clerk/nextjs'
import Head from 'next/head'
import Link from 'next/link'

export default function SignInPage() {
  return (
    <main className="auth-shell">
      <Head><title>Connexion · Scolo</title></Head>
      <Link href="/" className="auth-back">Retour à Scolo</Link>
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/" />
      <Link href="/confidentialite" className="auth-back">Tes données sur Scolo</Link>
    </main>
  )
}
