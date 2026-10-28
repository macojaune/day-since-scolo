import { SignInButton } from '@clerk/nextjs'
import { useEffect, useRef, useState } from 'react'
import ZikakLabel from '~/components/ZikakLabel'
import PersonalTickets from '~/components/PersonalTickets'
import type { PublicGame } from '~/server/game/types'
import { api, type RouterOutputs } from '~/utils/api'
import {
  analyticsErrorReason,
  betAnalyticsData,
  trackGameEvent,
} from '~/utils/analytics'
import {
  isCalendarDay,
  rememberDraftForSignIn,
  restorePredictionDraft,
} from '~/utils/game-draft'
import { formatDate, formatPoints, localInput } from '~/utils/game-format'

type Props = {
  game: PublicGame
  player?: RouterOutputs['app']['me']
  userId: string | null
  isSignedIn: boolean
  ready: boolean
}
const weekdays = ['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.', 'Dim.']
const DAY = 86_400_000
const WINDOW_DAYS = 28
const asDate = (day: string) => new Date(`${day}T00:00:00-04:00`)
const dayOf = (date: Date) => localInput(date).slice(0, 10)
function addDays(day: string, amount: number) {
  return dayOf(new Date(asDate(day).getTime() + amount * DAY))
}
function initialWindow(today: string, earliest: string) {
  // A long run must not open months in the past.
  return asDate(today).getTime() - asDate(earliest).getTime() < 14 * DAY
    ? earliest
    : today
}

export default function PredictionGame({
  game,
  player,
  userId,
  isSignedIn,
  ready,
}: Props) {
  const [windowStart, setWindowStart] = useState('')
  const [day, setDay] = useState('')
  const [stake, setStake] = useState('1')
  const [today, setToday] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const [receipt, setReceipt] = useState<{
    date: string
    stake: number
  } | null>(null)
  const request = useRef<{ payload: string; key: string } | null>(null)
  const sending = useRef(false)
  const restored = useRef<string | null>(null)
  const draftKey = `scolo-board-draft:${userId ?? 'visitor'}:${game.round.id}`
  const requestKey = `scolo-request:${userId}:${game.round.id}`
  const earliest = dayOf(
    new Date(game.lastAppearance?.occurredAt ?? game.round.openedAt)
  )
  const utils = api.useUtils()
  const bet = api.app.bet.useMutation({
    onSuccess: async (data, variables) => {
      if (!game.isSimulated) {
        trackGameEvent(
          'bet_confirmed',
          betAnalyticsData(variables.predictedAt, variables.stake),
          `confirmed:${data.prediction.id}`
        )
      }
      setReceipt({
        date: variables.predictedAt.toISOString(),
        stake: variables.stake,
      })
      request.current = null
      try {
        sessionStorage.removeItem(requestKey)
      } catch {
        /* Optional storage. */
      }
      await Promise.all([
        utils.app.game.invalidate(),
        utils.app.me.invalidate(),
      ])
    },
    onError: (error, variables) => {
      if (!game.isSimulated) {
        const reason = analyticsErrorReason(error.data?.code)
        trackGameEvent(reason === 'unavailable' || reason === 'server_error' ? 'bet_failed' : 'bet_rejected', {
          ...betAnalyticsData(variables.predictedAt, variables.stake),
          reason,
        })
      }
    },
    onSettled: () => {
      sending.current = false
    },
  })
  useEffect(() => {
    const currentDay = dayOf(new Date())
    setToday(currentDay)
    if (restored.current !== draftKey) {
      restored.current = draftKey
      const saved = restorePredictionDraft(game.round.id, userId)
      const start = initialWindow(currentDay, earliest)
      const selected = saved?.day && saved.day >= earliest ? saved.day : ''
      setDay(selected)
      setStake(saved?.stake ?? '1')
      setWindowStart(
        selected &&
          (selected < start || selected > addDays(start, WINDOW_DAYS - 1))
          ? selected
          : start
      )
      setHydrated(true)
    }
    const timer = setInterval(() => setToday(dayOf(new Date())), 15000)
    return () => clearInterval(timer)
  }, [draftKey, game.round.id, userId, earliest])
  useEffect(() => {
    if (!hydrated) return
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({ day, stake }))
    } catch {
      /* Optional storage. */
    }
  }, [day, stake, draftKey, hydrated])

  const amount = Number(stake)
  const noFunds = Boolean(player && player.balance === 0)
  const activeTickets =
    player?.predictions.filter(
      (ticket) => ticket.roundId === game.round.id && ticket.status === 'active'
    ) ?? []
  const activeTicketCount = activeTickets.length
  useEffect(() => {
    if (
      !game.isSimulated &&
      ready &&
      userId &&
      player?.registered &&
      noFunds
    ) {
      trackGameEvent(
        'wallet_empty',
        { committed: player.committed, tickets: activeTicketCount },
        `empty:${userId}:${game.round.id}`
      )
    }
  }, [
    game.isSimulated,
    game.round.id,
    ready,
    userId,
    player?.registered,
    player?.committed,
    noFunds,
    activeTicketCount,
  ])
  const myDays = new Map<string, { count: number; stake: number }>()
  for (const ticket of activeTickets) {
    const date = dayOf(new Date(ticket.predictedAt))
    const own = myDays.get(date) ?? { count: 0, stake: 0 }
    own.count++
    own.stake += ticket.stake
    myDays.set(date, own)
  }
  const validDay = Boolean(today && isCalendarDay(day) && day >= today)
  const validStake = Number.isSafeInteger(amount) && amount > 0
  const enough = Boolean(player && validStake && amount <= player.balance)
  const groups = new Map(
    game.round.groups.map((group) => [
      dayOf(new Date(group.predictedAt)),
      group,
    ])
  )
  const selected = groups.get(day)
  const odds =
    validDay && validStake
      ? (game.round.pot + amount) / ((selected?.totalStake ?? 0) + amount)
      : null
  const past = Boolean(day && today && day < today)
  const days = windowStart
    ? Array.from({ length: WINDOW_DAYS }, (_, index) =>
        addDays(windowStart, index)
      ).filter((value) => isCalendarDay(value))
    : []
  const leading = windowStart ? (asDate(windowStart).getUTCDay() + 6) % 7 : 0
  const windowEnd = days.at(-1)
  function edit() {
    setReceipt(null)
    bet.reset()
    request.current = null
  }
  function chooseDay(value: string, source: 'calendar' | 'ticket' = 'calendar') {
    if (sending.current || !isCalendarDay(value)) return
    if (!game.isSimulated && value !== day && today && value >= today) {
      trackGameEvent('bet_date_selected', {
        ...betAnalyticsData(asDate(value), Number(stake)),
        source,
      })
    }
    setDay(value)
    edit()
  }
  function chooseStake(value: string) {
    if (sending.current) return
    if (!game.isSimulated && value !== stake) {
      trackGameEvent(
        'bet_stake_changed',
        betAnalyticsData(asDate(day), Number(value))
      )
    }
    setStake(value)
    edit()
  }
  function moveWindow(offset: number) {
    if (!windowStart) return
    const next = addDays(windowStart, offset * WINDOW_DAYS)
    const start = next < earliest ? earliest : next
    if (isCalendarDay(start) && isCalendarDay(addDays(start, WINDOW_DAYS - 1)))
      setWindowStart(start)
  }
  function selectTicketDate(value: string) {
    chooseDay(value, 'ticket')
    if (value < windowStart || !windowEnd || value > windowEnd)
      setWindowStart(value)
    requestAnimationFrame(() =>
      document.querySelector('.calendar-selection')?.scrollIntoView({
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
        block: 'center',
      })
    )
  }
  function confirm() {
    if (
      !validDay ||
      !validStake ||
      !enough ||
      !userId ||
      !ready ||
      sending.current
    )
      return
    const predictedAt = asDate(day)
    const payload = JSON.stringify({
      viewerId: userId,
      roundId: game.round.id,
      predictedAt: predictedAt.toISOString(),
      amount,
    })
    if (!request.current) {
      try {
        const saved: unknown = JSON.parse(
          sessionStorage.getItem(requestKey) ?? 'null'
        )
        if (
          saved &&
          typeof saved === 'object' &&
          'payload' in saved &&
          saved.payload === payload &&
          'key' in saved &&
          typeof saved.key === 'string'
        )
          request.current = { payload, key: saved.key }
      } catch {
        /* Keep in-memory idempotency when storage is unavailable. */
      }
    }
    if (request.current?.payload !== payload)
      request.current = { payload, key: crypto.randomUUID() }
    try {
      sessionStorage.setItem(requestKey, JSON.stringify(request.current))
    } catch {
      /* Optional storage. */
    }
    sending.current = true
    if (!game.isSimulated) {
      trackGameEvent('bet_submitted', betAnalyticsData(predictedAt, amount))
    }
    bet.mutate({
      viewerId: userId,
      roundId: game.round.id,
      predictedAt,
      stake: amount,
      idempotencyKey: request.current.key,
    })
  }

  return (
    <section className="game-region" id="jeu" aria-labelledby="game-title">
      <header className="game-heading">
        <div>
          <h2 id="game-title">Parie sur la prochaine rencontre.</h2>
          <p>Choisis une date. Le jour le plus proche remporte la cagnotte.</p>
        </div>
        <div className="game-pot">
          <span>La cagnotte</span>
          <strong>
            {formatPoints(game.round.pot)}{' '}
            <small>
              <ZikakLabel />
            </small>
          </strong>
          <span>
            {game.round.participantCount} joueurs · {game.round.predictionCount}{' '}
            paris
          </span>
        </div>
      </header>
      <ol className="play-instructions" aria-label="Comment parier">
        <li>
          <span aria-hidden="true">1</span> Choisis ta date
        </li>
        <li>
          <span aria-hidden="true">2</span> Choisis ta mise
        </li>
        <li>
          <span aria-hidden="true">3</span>{' '}
          {isSignedIn ? 'Confirme ton pari' : 'Connecte-toi pour confirmer'}
        </li>
      </ol>
      <div className="board-region">
        {noFunds && (
          <div className="wallet-empty" role="status">
            <div>
              <strong>Tu n&apos;as plus de Zikak à miser.</strong>
              <p>
                {player && player.committed > 0
                  ? `${formatPoints(player.committed)} Zikak sont en jeu sur ${activeTickets.length} pari${activeTickets.length > 1 ? 's' : ''}. Si tu perds et que ton solde reste à zéro, tu recevras 2 Zikak pour rejouer.`
                  : 'Tes anciens paris restent consultables.'}
              </p>
            </div>
            <a href="#mes-paris">
              Voir mes paris <Arrow direction="right" />
            </a>
          </div>
        )}
        <div className="board-heading">
          <h3>Choisis ta date</h3>
          <button
            type="button"
            className="calendar-today"
            onClick={() => today && setWindowStart(today)}
            disabled={!today}
          >
            Aujourd&apos;hui
          </button>
        </div>
        <div className="calendar-toolbar">
          <button
            className="month-arrow"
            type="button"
            aria-label="Voir les dates précédentes"
            disabled={!windowStart || windowStart <= earliest}
            onClick={() => moveWindow(-1)}
          >
            <Arrow direction="left" />
          </button>
          <p className="calendar-range" aria-live="polite">
            {windowStart && windowEnd ? (
              <>
                {formatDate(asDate(windowStart), { month: 'short' })} au{' '}
                {formatDate(asDate(windowEnd), {
                  month: 'short',
                  year: 'numeric',
                })}
              </>
            ) : (
              'Chargement des dates…'
            )}
          </p>
          <button
            className="month-arrow"
            type="button"
            aria-label="Voir les dates suivantes"
            disabled={!windowStart || windowStart > '9999-11-01'}
            onClick={() => moveWindow(1)}
          >
            <Arrow direction="right" />
          </button>
        </div>
        <div className="calendar-weekdays" aria-hidden="true">
          {weekdays.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div
          className="calendar-grid"
          role="group"
          aria-label="Choisir la date de ton pari"
        >
          {Array.from({ length: leading }, (_, index) => (
            <span className="calendar-spacer" key={`space-${index}`} />
          ))}
          {days.map((date, index) => {
            const activity = groups.get(date)
            const mine = myDays.get(date)
            const isPast = Boolean(today && date < today)
            const todayCell = date === today
            const monthLabel = index === 0 || date.endsWith('-01')
            return (
              <button
                type="button"
                key={date}
                className={[
                  'calendar-day',
                  activity ? 'has-predictions' : '',
                  isPast ? 'day-past' : '',
                  mine ? 'has-own-prediction' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={bet.isPending || (isPast && !activity)}
                aria-pressed={day === date}
                aria-current={todayCell ? 'date' : undefined}
                aria-label={`${formatDate(asDate(date), { year: 'numeric' })}${todayCell ? ', aujourd’hui' : ''}, ${activity ? `${activity.predictionCount} paris au total, ${activity.totalStake} Zikak, cote ${formatPoints(activity.odds)}` : 'aucun pari'}${mine ? `, dont ${mine.count} pour toi, ${mine.stake} Zikak misés` : ''}${isPast ? ', date passée' : ''}`}
                onClick={() => chooseDay(date)}
              >
                {mine && (
                  <span className="calendar-owned">
                    {mine.count > 1 ? 'Tes paris' : 'Ton pari'}
                  </span>
                )}
                <span className="calendar-day-number">
                  {Number(date.slice(-2))}
                  {monthLabel && (
                    <small>
                      {formatDate(asDate(date), {
                        day: undefined,
                        month: 'short',
                      })}
                    </small>
                  )}
                </span>
                {todayCell && (
                  <span className="calendar-today-label">Aujourd&apos;hui</span>
                )}
                {activity && (
                  <span className="calendar-activity">
                    <span>
                      {activity.predictionCount}
                      <span className="calendar-paris-word">
                        {' '}
                        pari{activity.predictionCount > 1 ? 's' : ''}
                      </span>
                    </span>{' '}
                    <b>×{formatPoints(activity.odds)}</b>
                  </span>
                )}
              </button>
            )
          })}
        </div>
        {day ? (
          <section
            className="calendar-selection"
            aria-labelledby="selected-date-title"
          >
            <div className="selection-heading">
              <h3 id="selected-date-title">
                {past ? 'Les paris du' : 'Tu paries sur le'}{' '}
                <time dateTime={day}>
                  {formatDate(asDate(day), { year: 'numeric' })}
                </time>
              </h3>
              {selected && (
                <p>
                  {selected.predictionCount} pari
                  {selected.predictionCount > 1 ? 's' : ''} ·{' '}
                  {formatPoints(selected.totalStake)} Zikak misés
                </p>
              )}
              {myDays.has(day) && (
                <p className="selected-own">
                  Dont {myDays.get(day)!.count} pour toi ·{' '}
                  {formatPoints(myDays.get(day)!.stake)} Zikak
                </p>
              )}
            </div>
            {past ? (
              <p className="past-date-note">
                Cette date est passée. Les paris déjà posés restent en jeu.
              </p>
            ) : noFunds ? (
              <p className="past-date-note">
                Tu peux consulter les dates et tes paris. Il te faut des Zikak
                disponibles pour miser à nouveau.
              </p>
            ) : (
              <form
                className="calendar-bet"
                onSubmit={(event) => {
                  event.preventDefault()
                  confirm()
                }}
              >
                <div className="bet-stake">
                  <div className="stake-heading">
                    <span id="stake-title">Ta mise en</span>
                    <ZikakLabel />
                  </div>
                  <div
                    className="stake-input"
                    role="group"
                    aria-labelledby="stake-title"
                  >
                    <button
                      type="button"
                      aria-label="Réduire la mise"
                      disabled={bet.isPending || !validStake || amount <= 1}
                      onClick={() => chooseStake(String(amount - 1))}
                    >
                      −
                    </button>
                    <output
                      id="prediction-stake"
                      aria-label="Montant de ta mise"
                      aria-live="polite"
                    >
                      {formatPoints(amount)}
                    </output>
                    <button
                      type="button"
                      aria-label="Augmenter la mise"
                      disabled={
                        bet.isPending ||
                        Boolean(player && amount >= player.balance)
                      }
                      onClick={() =>
                        chooseStake(
                          String((Number.isFinite(amount) ? amount : 0) + 1)
                        )
                      }
                    >
                      +
                    </button>
                  </div>
                  {player && (
                    <p className="balance-note">
                      {enough
                        ? `${formatPoints(player.balance - amount)} Zikak restants après ce pari`
                        : `${formatPoints(player.balance)} Zikak disponibles`}
                    </p>
                  )}
                </div>
                <div className="payout-preview" aria-live="polite">
                  {odds ? (
                    <>
                      <span>Si ton pari gagne, tu reçois</span>
                      <strong>
                        {formatPoints(amount * odds)} <small>Zikak</small>
                      </strong>
                      <p>
                        Estimation, mise comprise · cote ×{formatPoints(odds)}
                      </p>
                    </>
                  ) : (
                    <p>Choisis une mise d&apos;au moins 1 Zikak.</p>
                  )}
                </div>
                <div className="bet-confirm">
                  {!isSignedIn ? (
                    <SignInButton mode="redirect" forceRedirectUrl="/#jeu">
                      <button
                        className="button button-primary"
                        type="button"
                        disabled={!validDay || !validStake}
                        onClick={() => {
                          rememberDraftForSignIn(game.round.id)
                          if (!game.isSimulated) {
                            trackGameEvent('game_sign_in_requested', {
                              ...betAnalyticsData(asDate(day), amount),
                              source: 'bet',
                            })
                          }
                        }}
                      >
                        Me connecter pour confirmer
                      </button>
                    </SignInButton>
                  ) : (
                    <button
                      className="button button-primary"
                      type="submit"
                      disabled={
                        !ready ||
                        !player ||
                        !validDay ||
                        !enough ||
                        bet.isPending
                      }
                    >
                      {bet.isPending
                        ? 'Enregistrement…'
                        : !ready || !player
                          ? 'Chargement de ton compte…'
                          : `Parier ${validStake ? formatPoints(amount) : ''} Zikak`}
                    </button>
                  )}
                  <p>
                    {isSignedIn
                      ? 'Une fois confirmé, ton pari est définitif.'
                      : 'Ta date et ta mise sont gardées.'}
                  </p>
                </div>
                {player && validStake && !enough && (
                  <p className="bet-message" role="status">
                    {player.balance === 0
                      ? 'Tu n’as plus de Zikak disponibles.'
                      : `Il te manque ${formatPoints(amount - player.balance)} Zikak.`}
                  </p>
                )}
                {bet.error && (
                  <p className="bet-message" role="alert">
                    {bet.error.message} Ton choix est conservé.
                  </p>
                )}
                {receipt && (
                  <div className="ticket-receipt" role="status">
                    <CheckMark />
                    <p>
                      <strong>Pari enregistré.</strong>{' '}
                      {formatPoints(receipt.stake)} Zikak sur le{' '}
                      {formatDate(receipt.date, { year: 'numeric' })}.
                    </p>
                  </div>
                )}
                <p className="bet-odds-note">
                  La cote change avec les mises. Si deux jours sont à égalité,
                  leurs paris gagnants se partagent la cagnotte.
                </p>
              </form>
            )}
          </section>
        ) : (
          <p className="calendar-invitation">
            Clique sur une date pour choisir ta mise.
          </p>
        )}
      </div>
      {isSignedIn &&
        (player ? (
          <PersonalTickets
            predictions={player.predictions}
            committed={player.committed}
            roundId={game.round.id}
            onSelectDate={selectTicketDate}
          />
        ) : (
          <p role="status" className="tickets-loading">
            Chargement de tes paris…
          </p>
        ))}
      {game.recentResult && (
        <p className="last-result">
          Dernière manche : {formatPoints(game.recentResult.pot)} Zikak
          distribués
          {game.recentResult.winningDistanceMs === null
            ? ' · aucun pari admissible'
            : game.recentResult.winningDistanceMs === 0
              ? ' · date exacte trouvée'
              : ` · meilleur écart : ${Math.round(game.recentResult.winningDistanceMs / DAY)} jours`}
          {game.recentResult.totalReplayBonus > 0 &&
            ` · ${formatPoints(game.recentResult.totalReplayBonus)} Zikak ajoutés aux joueurs perdants sans solde pour rejouer`}
          .
        </p>
      )}
      <details className="game-rules" id="regles">
        <summary>Comment on gagne ?</summary>
        <div>
          <p>
            Le jour le plus proche de la prochaine rencontre gagne, avant ou
            après. Si plusieurs paris gagnent, la cagnotte est partagée selon
            leurs mises.
          </p>
          <p>
            La cote indique combien ta mise pourrait rapporter, mise comprise.
            Elle change avec les nouveaux paris. Ce n&apos;est pas une
            probabilité.
          </p>
          <p>
            Tu peux miser sur plusieurs dates, autant que ton solde le permet.
            Les dates sont celles de Guadeloupe. Les paris posés après la
            rencontre sont remboursés, même si je la déclare plus tard.
          </p>
          <p>
            Tu reçois 3 Zikak pour commencer. À la fin d&apos;une manche, si tu
            as perdu et que ton solde est à zéro après les gains et les
            remboursements, tu reçois 2 Zikak pour rejouer. Une seule fois par
            manche. S&apos;il te reste des Zikak ou si un de tes paris a gagné,
            tu ne reçois pas ce bonus.
          </p>
        </div>
      </details>
    </section>
  )
}

function Arrow({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        d={
          direction === 'left'
            ? 'M19 12H5m6-6-6 6 6 6'
            : 'M5 12h14m-6-6 6 6-6 6'
        }
      />
    </svg>
  )
}
function CheckMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 12 4 4L19 6" />
    </svg>
  )
}
