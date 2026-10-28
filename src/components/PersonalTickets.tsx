import { useId } from 'react'
import type { Prediction } from '~/server/game/types'
import {
  formatDate,
  formatPoints,
  GAME_TIMEZONE,
  localInput,
} from '~/utils/game-format'

type Props = {
  predictions: Prediction[]
  committed: number
  roundId: string
  onSelectDate: (date: string) => void
}

const statuses = {
  active: 'En jeu',
  won: 'Gagné',
  lost: 'Perdu',
  refunded: 'Remboursé',
}
const dateParts = new Intl.DateTimeFormat('fr-FR', {
  timeZone: GAME_TIMEZONE,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

export default function PersonalTickets({
  predictions,
  committed,
  roundId,
  onSelectDate,
}: Props) {
  const titleId = useId()
  const sortedPredictions = [...predictions].sort(
    (a, b) =>
      Date.parse(a.predictedAt) - Date.parse(b.predictedAt) ||
      Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
      a.id.localeCompare(b.id)
  )

  return (
    <section
      className="tickets-region"
      id="mes-paris"
      aria-labelledby={titleId}
    >
      <div className="lottery-heading">
        <h3 id={titleId}>Tes paris</h3>
        <span>{formatPoints(committed)} Zikak en jeu</span>
      </div>
      {predictions.length === 0 ? (
        <p className="lottery-empty">
          Tu n&apos;as pas encore parié. Choisis une date dans le calendrier.
        </p>
      ) : (
        <ul className="lottery-grid">
          {sortedPredictions.map((ticket) => {
            const parts = dateParts.formatToParts(new Date(ticket.predictedAt))
            const day = parts.find((part) => part.type === 'day')!.value
            const month = parts.find((part) => part.type === 'month')!.value
            const year = parts.find((part) => part.type === 'year')!.value
            const active =
              ticket.status === 'active' && ticket.roundId === roundId
            const dateLabel = formatDate(ticket.predictedAt, {
              year: 'numeric',
            })
            const description = `${dateLabel}, ${formatPoints(ticket.stake)} Zikak misés, ${statuses[ticket.status]}`
            const classes = ['lottery-ticket', `lottery-${ticket.status}`].join(
              ' '
            )
            const content = (
              <>
                <time className="lottery-date" dateTime={ticket.predictedAt}>
                  <strong className="lottery-day">{day}</strong>
                  <span className="lottery-month">
                    {month} {year}
                  </span>
                </time>
                <span className="lottery-stake">
                  <strong>{formatPoints(ticket.stake)} Zikak</strong>
                  <span>misés</span>
                </span>
                <span className="lottery-status">
                  {statuses[ticket.status]}
                </span>
                {ticket.status !== 'active' && (
                  <span className="lottery-payout">
                    {formatPoints(ticket.payout)} Zikak reçus
                  </span>
                )}
              </>
            )

            return (
              <li key={ticket.id}>
                {active ? (
                  <button
                    type="button"
                    className={classes}
                    aria-label={`${description}. Voir cette date dans le calendrier.`}
                    onClick={() =>
                      onSelectDate(
                        localInput(new Date(ticket.predictedAt)).slice(0, 10)
                      )
                    }
                  >
                    {content}
                  </button>
                ) : (
                  <article className={classes} aria-label={description}>
                    {content}
                  </article>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <style jsx>{`
        .lottery-heading {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 8px 16px;
          margin-bottom: 18px;
        }
        .lottery-heading > span {
          color: #bcbcbc;
          font-size: 0.8rem;
          font-variant-numeric: tabular-nums;
        }
        .lottery-empty {
          color: #bcbcbc;
          font-size: 0.85rem;
        }
        .lottery-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(132px, 152px));
          align-items: stretch;
          gap: 12px;
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .lottery-grid > li {
          min-width: 0;
        }
        .lottery-ticket {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
          height: 100%;
          min-height: 184px;
          padding: 15px 12px 13px;
          border: 1px solid #fff;
          border-radius: 6px;
          color: #000;
          background: #fff;
          text-align: center;
          font: inherit;
          font-variant-numeric: tabular-nums;
          overflow-wrap: anywhere;
        }
        button.lottery-ticket {
          border-color: #facc15;
        }
        button.lottery-ticket:hover {
          background: #facc15;
        }
        button.lottery-ticket:focus-visible {
          outline: 3px solid #f59e0b;
          outline-offset: 4px;
        }
        .lottery-date {
          display: grid;
          gap: 3px;
          width: 100%;
        }
        .lottery-day {
          font-size: 2.35rem;
          font-weight: 700;
          line-height: 1;
          letter-spacing: -0.03em;
        }
        .lottery-month {
          font-size: 0.75rem;
          line-height: 1.4;
        }
        .lottery-stake {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          justify-content: center;
          gap: 3px 5px;
          width: 100%;
          margin-top: 13px;
          padding-top: 11px;
          border-top: 1px dashed #8b8b8b;
          line-height: 1.4;
        }
        .lottery-stake strong {
          font-size: 0.85rem;
          font-weight: 650;
        }
        .lottery-stake > span {
          font-size: 0.65rem;
        }
        .lottery-status {
          margin-top: 10px;
          font-size: 0.75rem;
          font-weight: 650;
          line-height: 1.3;
        }
        .lottery-payout {
          margin-top: 5px;
          font-size: 0.67rem;
          line-height: 1.4;
        }
        .lottery-won {
          background: #facc15;
          border-color: #facc15;
        }
        .lottery-lost {
          color: #bcbcbc;
          background: #141414;
          border-color: #38342a;
        }
        .lottery-refunded {
          background: #000;
          color: #fff;
          border-color: #f59e0b;
        }
        .lottery-refunded .lottery-status {
          color: #f59e0b;
        }
        @media (max-width: 560px) {
          .lottery-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }
          .lottery-ticket {
            min-height: 178px;
            padding-inline: 10px;
          }
        }
      `}</style>
    </section>
  )
}
