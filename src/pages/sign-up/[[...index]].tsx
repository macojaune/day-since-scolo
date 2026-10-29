import { SignUp } from '@clerk/nextjs'
import Head from 'next/head'
import Link from 'next/link'

export default function SignUpPage() {
  return (
    <main className="auth-shell">
      <Head><title>Inscription · BÈT a milpat</title></Head>
      <Link href="/" className="auth-back">Retour à BÈT a milpat</Link>
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/" />
      <Link href="/confidentialite" className="auth-back">Tes données sur BÈT a milpat</Link>
    </main>
  )
}
