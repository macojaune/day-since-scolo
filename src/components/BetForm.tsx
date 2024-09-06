import { signIn, useSession } from 'next-auth/react'
import { useState } from 'react'
import type { Encounter } from '~/server/db/schema'
import { api } from '~/utils/api'

const BetForm = ({ encounter }: { encounter: Encounter }) => {
  const { data: session } = useSession()
  const totalCredits = 3 //todo fetch userCredits
  const [date, setDate] = useState(new Date())
  const [success, setSuccess] = useState<boolean | null>(null)
  const { data: credits } = api.credits.useQuery(
    { id: session?.user.id },
    { enabled: !!session?.user.id }
  )

  const { mutate, isPending } = api.bet.useMutation({
    onSuccess: (data, variables, context) => {
      setSuccess(true)
    },
  })

  const handleBet = async () => {
    try {
      await mutate({ date, encounterId: encounter.id })
    } catch (error) {
      console.error(error)
    }
  }

  return (
    <div className="flex flex-col rounded-md bg-yellow-400 p-4">
      <h2 className="text-start text-3xl mb-4">"Parie" sur la prochaine rencontre</h2>
      {!session ? (
        <button onClick={() => signIn()} className='w-fit self-center rounded-md bg-black px-8 py-4 text-white hover:bg-gray-800'>Se connecter</button>
      ) : (
        <div className="flex flex-col items-center justify-between gap-3">
          <div className="flex w-full flex-row items-baseline gap-2">
            {/* <span>Connecté·e en tant que @{user?.username}</span> */}
            {/* <SignOutButton> */}
            <button className="text-sm text-red-800 hover:font-bold">
              Déconnexion
            </button>
            {/* </SignOutButton> */}
          </div>
          <div>
            <p>Choisis une date</p>
            <input
              type="date"
              className=""
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
              className="w-fit rounded-md bg-black px-8 py-4 text-white hover:bg-gray-800"
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
        </div>
      )}
    </div>
  )
}
export default BetForm
