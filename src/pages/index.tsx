import { useEffect, useState } from 'react'
import { signIn, signOut, useSession } from 'next-auth/react'
import Head from 'next/head'
import Image from 'next/image'
import BetForm from '~/components/BetForm'
import SpawnTable from '~/components/SpawnTable'
import { api } from '~/utils/api'

import toolImg from '/public/digrain.png'
import type { Encounter } from '~/server/db/schema'
const imageDetails = {
  digrain: { width: 500, height: 900 },
  capes: { width: 207, height: 749 },
  coutelas: { width: 500, height: 500 },
  sandale: { width: 1120, height: 1120 },
}
const Picture = ({ encounter }: { encounter: Encounter | null }) => {
  return (
    <div className="flex flex-col items-center justify-center">
      <Image
        src={encounter?.tool ? `/${encounter?.tool}.png` : toolImg}
        alt={encounter?.tool ?? 'Digrain'}
        className="object-contain object-center"
        width={imageDetails[encounter?.tool ?? 'digrain'].width}
        height={imageDetails[encounter?.tool ?? 'digrain'].height}
      />
      <span className="text-center text-white sm:mt-2 text-xl">L'arme du jour</span>
      <span className="text-center text-base text-yellow-400">
        On fait avec ce qu'on à…
      </span>
    </div>
  )
}
export default function Home() {
  const [duration, setDuration] = useState(0)
  const { data } = api.app.getLatest.useQuery<Encounter[]>()

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date()
      const since = new Date(data?.[0]?.createdAt)
      // @ts-expect-error dates
      setDuration(now - since)
    }, 100)

    return () => clearInterval(interval)
  }, [data])

  const seconds = Math.floor(duration / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  return (
    <div className="h-full w-full bg-black px-4 py-8 sm:p-8">
      <Head>
        <title>Jou san bèt a mil pat</title>
        <meta charSet="UTF-8" />
        <link rel="icon" type="image/svg+xml" href="/vite.svg" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>
      <h1 className="my-4 text-center text-4xl font-bold leading-5 text-yellow-400 sm:text-8xl sm:leading-6">
        Jou san bèt a mil pat
        <br />
        <small className="text-sm italic">
          &ldquo;Jours sans scolopendre&rdquo;
        </small>
      </h1>
      <p className="mx-auto mb-4 max-w-4xl text-justify text-white">
        Né dans la frustration de cohabiter avec les insectes que j'apprécie le
        moins, ce site était principalement un moyen de combler mon insomnie et
        pleurer ma peine en public. <br />
        Je ne sais pas si j'habite chez eux, ou si ils habitent chez moi. Tout
        ce que je sais c'est que j'en vois trop souvent et que mon budget
        Digrain est trop élevé. <br />
        <span className="italic text-amber-500">
          Si ta tante à une maison à louer fais-moi signe.
        </span>
      </p>
      <div
        className={`flex w-full flex-col items-center gap-5 sm:flex-row sm:justify-evenly`}
      >
        <div className="flex w-full flex-col items-center justify-center gap-y-8 sm:w-3/5">
          <div
            className={`grid ${days > 0 ? 'grid-cols-4' : 'grid-cols-3'} w-full gap-x-3 sm:w-1/2`}
          >
            {days > 0 ? (
              <p className="flex aspect-square flex-col justify-center rounded-md bg-white p-4 text-center text-4xl text-black sm:text-7xl">
                {days.toString().padStart(2, '0')} <br />
                <small className="text-center text-base sm:text-lg">
                  jours
                </small>
              </p>
            ) : null}
            <p className="flex aspect-square flex-col justify-center rounded-md bg-white p-4 text-center text-4xl text-black sm:text-7xl">
              {(hours % 24).toString().padStart(2, '0')} <br />
              <small className="text-center text-base sm:text-lg">heures</small>
            </p>
            <p className="flex aspect-square flex-col justify-center rounded-md bg-white p-4 text-center text-4xl text-black sm:text-7xl">
              {(minutes % 60).toString().padStart(2, '0')}
              <br />
              <small className="text-center text-base sm:text-lg">
                minutes
              </small>
            </p>
            <p className="flex aspect-square flex-col justify-center rounded-md bg-white p-4 text-center text-4xl text-black sm:text-7xl">
              {(seconds % 60).toString().padStart(2, '0')}
              <br />
              <small className="text-center text-base sm:text-lg">sec</small>
            </p>
          </div>
          <div className="block sm:hidden">
            <Picture encounter={data?.[0]} />
          </div>
          <BetForm encounter={data?.[0]} />
          {data ? <SpawnTable data={data} /> : null}
        </div>
        <div className="hidden w-full flex-col sm:flex sm:w-1/2">
          <Picture />
        </div>
      </div>
      <p className="mt-6 text-center font-light text-white">
        Du coup, si vous avez une maison pour moi,{' '}
        <i className="font-bold text-orange-500">garantie SANS scolo…</i>{" "}
        <a
          className="font-bold text-yellow-400 hover:underline"
          href="https://t.me/macojaune"
        >
          Je prends
        </a>{' '}
        !
      </p>
      <p className="mt-12 text-center text-sm text-white">
        Site créé{' '}
        <u className="font-bold italic underline">dans la frustration</u> par{' '}
        <a href="https://marvinl.com" className="font-bold hover:underline">
          MarvinL.com
        </a>
      </p>
    </div>
  )
}

function AuthShowcase() {
  const { data: sessionData } = useSession()

  const { data: secretMessage } = api.post.getSecretMessage.useQuery(
    undefined, // no input
    { enabled: sessionData?.user !== undefined }
  )

  return (
    <div className="flex flex-col items-center justify-center gap-4">
      <p className="text-center text-2xl text-white">
        {sessionData && <span>Logged in as {sessionData.user?.name}</span>}
        {secretMessage && <span> - {secretMessage}</span>}
      </p>
      <button
        className="rounded-full bg-white/10 px-10 py-3 font-semibold text-white no-underline transition hover:bg-white/20"
        onClick={sessionData ? () => void signOut() : () => void signIn()}
      >
        {sessionData ? 'Sign out' : 'Sign in'}
      </button>
    </div>
  )
}
