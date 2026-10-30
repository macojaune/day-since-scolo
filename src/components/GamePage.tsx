import { useAuth, SignInButton, UserButton } from '@clerk/nextjs'
import { useEffect, useRef, useState } from 'react'
import Head from 'next/head'
import Image from 'next/image'
import SandaleEasterEgg from '~/components/sandale/SandaleEasterEgg'
import Link from 'next/link'
import EncounterHistory from '~/components/EncounterHistory'
import PredictionGame from '~/components/PredictionGame'
import ZikakLabel from '~/components/ZikakLabel'
import type { PublicGame } from '~/server/game/types'
import { api } from '~/utils/api'
import { BRAND_NAME } from '~/utils/brand'
import { trackGameEvent } from '~/utils/analytics'
import { rememberDraftForSignIn } from '~/utils/game-draft'
import {
  formatDate,
  formatInstant,
  formatPoints,
  formatTime,
} from '~/utils/game-format'

export default function GamePage() {
  const { isLoaded, isSignedIn, userId } = useAuth()
  const [joinedUser, setJoinedUser] = useState<string | null>(null)
  const [newEnrollment, setNewEnrollment] = useState<{ playerId: string; viewerId: string } | null>(null)
  const joiningUser = useRef<string | null>(null)
  const activeUser = useRef(userId)
  activeUser.current = userId
  const utils = api.useUtils()
  const game = api.app.game.useQuery(undefined, { refetchInterval: 15000 })
  const me = api.app.me.useQuery(
    { viewerId: userId ?? '' },
    { enabled: Boolean(isSignedIn && joinedUser === userId), retry: false }
  )
  const join = api.app.join.useMutation({
    onSuccess: async (data, variables) => {
      if (variables.viewerId === activeUser.current) {
        if (data.created) setNewEnrollment({ playerId: data.id, viewerId: variables.viewerId })
        await utils.app.me.reset({ viewerId: variables.viewerId })
        if (variables.viewerId === activeUser.current)
          setJoinedUser(variables.viewerId)
      }
    },
  })
  useEffect(() => {
    setJoinedUser(null)
    if (isLoaded && isSignedIn && userId && joiningUser.current !== userId) {
      joiningUser.current = userId
      join.mutate({ viewerId: userId })
    }
    if (isLoaded && !isSignedIn) joiningUser.current = null
    // Enrollment is idempotent and tied to the authenticated identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, userId])
  useEffect(() => {
    if (!newEnrollment || !game.data) return
    if (newEnrollment.viewerId === userId && game.data.isSimulated === false) {
      trackGameEvent('game_joined', undefined, newEnrollment.playerId)
    }
    setNewEnrollment(null)
  }, [newEnrollment, game.data, userId])
  const player = joinedUser === userId ? me.data : undefined

  return (
    <div className="scolo-app">
      <Head>
        <title>{BRAND_NAME} · Jou san bèt a mil pat</title>
        <meta
          name="description"
          content="Le compteur de jours sans scolopendre, le journal des rencontres et tes pronostics sur la prochaine apparition."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      {game.data?.isSimulated && <div className="sandbox-note">
        {game.data.environment === 'dev' ? 'Environnement DEV' : 'Bac à sable local'} · Zikak de test
      </div>}
      <div className="page-shell">
        <header className="site-header">
          <Link className="wordmark" href="/" aria-label={`${BRAND_NAME}, accueil`}>
            <span className="wordmark-main">BÈT</span>
            <span className="wordmark-suffix">a milpat</span>
          </Link>
          <nav aria-label="Navigation principale">
            <a href="#run">Le run</a>
            <a href="#rencontres">Les rencontres</a>
            <a href="#jeu">Le jeu</a>
            {player?.isAdmin && (
              <Link href="/admin">Déclarer une apparition</Link>
            )}
          </nav>
          <div className="account-controls">
            {isLoaded && isSignedIn ? (
              <>
                <span className="wallet-pill">
                  {player ? formatPoints(player.balance) : '…'}{' '}
                  <span>
                    <ZikakLabel showIcon={false} /> disponibles
                  </span>
                </span>
                <UserButton />
              </>
            ) : (
              <SignInButton mode="redirect" forceRedirectUrl="/#jeu">
                <button
                  className="button button-small"
                  type="button"
                  onClick={() => {
                    if (game.data?.isSimulated !== true)
                      trackGameEvent('game_sign_in_requested', { source: 'header' })
                    if (game.data) {
                      rememberDraftForSignIn(game.data.round.id)
                    }
                  }}
                >
                  Se connecter
                </button>
              </SignInButton>
            )}
          </div>
        </header>
        {join.error && (
          <p className="error-message" role="alert">
            {join.error.message}{' '}
            <button
              type="button"
              onClick={() => userId && join.mutate({ viewerId: userId })}
            >
              Réessayer
            </button>
          </p>
        )}
        {me.error && (
          <p className="error-message" role="alert">
            {me.error.message}{' '}
            <button type="button" onClick={() => void me.refetch()}>
              Recharger mes points
            </button>
          </p>
        )}
        {game.isPending && (
          <div className="loading-state" role="status">
            On regarde si la voie est libre…
          </div>
        )}
        {game.error && (
          <div className="error-message" role="alert">
            <p>{game.error.message}</p>
            <button
              className="button"
              type="button"
              onClick={() => void game.refetch()}
            >
              Réessayer
            </button>
          </div>
        )}
        {game.data && (
          <main>
            <section className="site-story" aria-labelledby="site-title">
              <h1 id="site-title">Jou san bèt a mil pat</h1>
              <p className="translation">« Jours sans scolopendre »</p>
              <p className="original-intro">
                Né dans la frustration de cohabiter avec les insectes que
                j’apprécie le moins, ce site est un moyen de combler mon
                insomnie et de pleurer ma peine en public. Je ne sais pas si
                j’habite chez eux ou s’ils habitent chez moi. Tout ce que je
                sais, c’est que mon budget Digrain est trop élevé.{' '}
                <span>Si ta tante a une maison à louer, fais-moi signe.</span>
              </p>
            </section>
            <div className="observation-layout">
              <CurrentRun game={game.data} />
              <LastEncounter game={game.data} />
            </div>
            <EncounterHistory history={game.data.history} />
            <PredictionGame
              key={`${userId ?? 'visitor'}:${game.data.round.id}`}
              game={game.data}
              player={player}
              userId={userId ?? null}
              isSignedIn={Boolean(isSignedIn)}
              ready={isLoaded && joinedUser === userId}
            />
          </main>
        )}
        <footer className="site-footer">
          <p className="footer-signature">
            barricadé entre deux coups de digrain par{' '}
            <a href="https://marvinl.com">MarvinL.com</a>
          </p>
          <p className="footer-details">
            <span>Parie avec des points fictifs. Aucun argent réel.</span>
            <Link href="/confidentialite">Confidentialité</Link>
          </p>
        </footer>
      </div>
    </div>
  )
}

function CurrentRun({ game }: { game: PublicGame }) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const since = game.lastAppearance?.occurredAt
  const elapsed =
    now && since ? Math.max(0, now - new Date(since).getTime()) : null
  const values =
    elapsed === null
      ? ['—', '—', '—', '—']
      : [
          Math.floor(elapsed / 86400000),
          Math.floor(elapsed / 3600000) % 24,
          Math.floor(elapsed / 60000) % 60,
          Math.floor(elapsed / 1000) % 60,
        ].map((n) => String(n).padStart(2, '0'))
  return (
    <section className="run-region" id="run" aria-labelledby="run-title">
      <h2 id="run-title">Pourvu que ça dure.</h2>
      <p>Le run actuel, sans la moindre apparition.</p>
      <div
        className="counter-line"
        aria-label="Temps depuis la dernière apparition"
      >
        {values.map((value, index) => (
          <div className="counter-unit" key={index}>
            <strong className={value.length > 3 ? 'counter-long' : undefined}>
              {value}
            </strong>
            <span>{['jours', 'heures', 'minutes', 'secondes'][index]}</span>
          </div>
        ))}
      </div>
      <p className="run-since">
        {since ? (
          <>
            Tranquille depuis le{' '}
            <time dateTime={since}>{formatInstant(since)}</time>.
          </>
        ) : (
          'Le compteur démarrera à la première rencontre enregistrée.'
        )}
      </p>
    </section>
  )
}

function LastEncounter({ game }: { game: PublicGame }) {
  const encounter = game.lastAppearance
  const weapons: Record<string, string> = {
    sandale: 'Sandale',
    coutelas: 'Coutelas',
    capes: 'CAPES',
    digrain: 'Digrain',
  }
  return (
    <section className="weapon-region" aria-labelledby="last-encounter-title">
      <div>
        <h2 id="last-encounter-title">La dernière rencontre</h2>
        {encounter ? (
          <>
            <time dateTime={encounter.occurredAt}>
              {formatDate(encounter.occurredAt, { year: 'numeric' })}
              <span>à {formatTime(encounter.occurredAt)}</span>
            </time>
            <p className="weapon-caption">
              L’arme du jour :{' '}
              <strong>{weapons[encounter.tool] ?? encounter.tool}</strong>
            </p>
            <p className="weapon-joke">On fait avec ce qu’on a…</p>
          </>
        ) : (
          <p>Aucune rencontre enregistrée.</p>
        )}
      </div>
      {encounter && Object.hasOwn(weapons, encounter.tool) && (
        encounter.tool === 'sandale' ? <SandaleEasterEgg /> : <Image
          src={`/${encounter.tool}.png`}
          width={200}
          height={200}
          alt={weapons[encounter.tool] ?? encounter.tool}
        />
      )}
    </section>
  )
}
