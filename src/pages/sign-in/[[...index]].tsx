import { SignIn } from '@clerk/nextjs'
import Head from 'next/head'
import Link from 'next/link'

export default function SignInPage() {
  return (
    <main className="auth-shell">
      <Head><title>Connexion · BÈT a milpat</title></Head>
      <Link href="/" className="auth-back">Retour à BÈT a milpat</Link>
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/" />
      <Link href="/confidentialite" className="auth-back">Tes données sur BÈT a milpat</Link>
    </main>
  )
}
