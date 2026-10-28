import { SignUp } from '@clerk/nextjs'
import Head from 'next/head'
import Link from 'next/link'

export default function SignUpPage() {
  return (
    <main className="auth-shell">
      <Head><title>Inscription · Scolo</title></Head>
      <Link href="/" className="auth-back">Retour à Scolo</Link>
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/" />
      <Link href="/confidentialite" className="auth-back">Tes données sur Scolo</Link>
    </main>
  )
}
