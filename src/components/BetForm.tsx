'use client'
import { useState, useEffect } from 'react'
import { signIn, useSession } from 'next-auth/react'
import type { Encounter } from '~/server/db/schema'
import { api } from '~/utils/api'

const BetForm = ({ encounter }: { encounter: Encounter }) => {
  const { data: session } = useSession()
  const [totalCredits, setCredits] = useState(3)
  const [date, setDate] = useState(new Date())
  const [success, setSuccess] = useState(false)
  const { data: credits, refetch } = api.app.credits.useQuery(
    {},
    { enabled: !!session?.user }
  )

  const { mutate, isPending } = api.app.bet.useMutation({
    onSuccess: (data, variables, context) => {
      refetch()
      setSuccess(true)
    },
  })

  useEffect(() => {
    setCredits((prev) => credits?.[0]?.credit ?? prev)
  }, [credits])

  const handleBet = async () => {
    mutate({
      date,
      spawnId: encounter.id,
      credits: credits?.[0]?.credit ?? 3,
    })
  }

  return (
    <div className="flex flex-col rounded-md bg-yellow-400 p-4">
      <h2 className="mb-4 text-start text-3xl">
        "Parie" sur la prochaine rencontre
      </h2>
      {!session && (
        <button
          onClick={() => signIn()}
          className="w-fit self-center rounded-md bg-black px-8 py-4 text-white hover:bg-gray-800"
        >
          Se connecter
        </button>
      )}
      {session && (
        <div className="flex flex-col items-center justify-between gap-3">
          <div className="flex w-full flex-row items-baseline gap-2">
            {/* <span>Connecté·e en tant que @{user?.username}</span> */}
            {/* <SignOutButton> */}
            <button className="text-sm text-red-800 hover:font-bold">
              Déconnexion
            </button>
            {/* </SignOutButton> */}
          </div>
          {!success && (
            <>
              <div>
                <p className="text-center">Choisis une date</p>
                <input
                  type="date"
                  className="rounded-md border-transparent px-3 py-2 focus:border-transparent focus:outline-none focus:ring-0 focus:ring-offset-0"
                  min={new Date().toISOString().substring(0, 10)}
                  value={date.toISOString().substring(0, 10)}
                  onChange={(e) => setDate(new Date(e.target.value))}
                  required
                />
              </div>
              <div className="flex flex-col items-center px-4">
                <span className="text-sm italic">
                  {totalCredits} crédits disponibles
                </span>
                <button
                  onClick={handleBet}
                  className="w-fit rounded-md bg-black px-8 py-4 text-white hover:bg-gray-800 disabled:bg-zinc-500"
                  disabled={isPending || totalCredits < 3}
                >
                  {isPending ? (
                    'Patientons…'
                  ) : (
                    <>
                      <b className="font-semibold">Miser</b>{' '}
                      <i className="italic">(3 crédits)</i>
                    </>
                  )}
                </button>
              </div>
            </>
          )}
          {success && (
            <div>
              <p className="text-center">
                "Pari" enregistré avec succès ! <br />
                Invite tes potes à faire pareil et tu recevras un mail si t'as
                gagné ou perdu.
              </p>
              <div className="flex flex-row">réseaux sociaux</div>
              {totalCredits >= 3 && (
                <p>
                  Il te reste {totalCredits} crédits
                  <button onClick={() => setSuccess(false)}>
                    tente un autre pari
                  </button>
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
export default BetForm
