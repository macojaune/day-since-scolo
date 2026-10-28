import { useMemo, useRef, useState } from 'react'
import type { Appearance } from '~/server/game/types'
import { formatDate } from '~/utils/game-format'

const defenseNames: Record<string, string> = {
  sandale: 'Sandale',
  coutelas: 'Coutelas',
  digrain: 'Digrain',
  capes: 'CAPES',
}
const PAGE_SIZE = 8

function intervalLabel(milliseconds: number | null) {
  if (milliseconds === null) return 'Écart inconnu'
  if (milliseconds === 0) return 'Au même moment'
  const days = Math.floor(milliseconds / 86400000)
  if (days) return `${days} j d’écart`
  const hours = Math.floor(milliseconds / 3600000)
  if (hours) return `${hours} h d’écart`
  const minutes = Math.floor(milliseconds / 60000)
  if (minutes) return `${minutes} min d’écart`
  return `${Math.floor(milliseconds / 1000)} s d’écart`
}

export default function EncounterHistory({
  history,
}: {
  history: Appearance[]
}) {
  const [requestedPage, setPage] = useState(0)
  const list = useRef<HTMLOListElement>(null)
  const rows = useMemo(() => {
    const chronological = history
      .map((appearance) => ({
        ...appearance,
        timestamp: new Date(appearance.occurredAt).getTime(),
      }))
      .filter((appearance) => Number.isFinite(appearance.timestamp))
      .sort((a, b) => a.timestamp - b.timestamp || a.id - b.id)

    // Keep the previous encounter outside the visible page when computing gaps.
    return chronological
      .map((appearance, index) => ({
        ...appearance,
        sincePrevious:
          index > 0
            ? appearance.timestamp - chronological[index - 1]!.timestamp
            : null,
      }))
      .reverse()
  }, [history])
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const page = Math.min(requestedPage, pageCount - 1)
  const first = page * PAGE_SIZE

  function changePage(nextPage: number) {
    setPage(Math.max(0, Math.min(nextPage, pageCount - 1)))
    requestAnimationFrame(() => {
      list.current?.focus({ preventScroll: true })
    })
  }

  return (
    <section
      className="history-region"
      id="rencontres"
      aria-labelledby="history-title"
    >
      <div className="history-heading">
        <h2 id="history-title">Les dernières rencontres</h2>
        <span className="history-total">
          {rows.length} rencontre{rows.length > 1 ? 's' : ''} enregistrée
          {rows.length > 1 ? 's' : ''}
        </span>
      </div>
      {!rows.length ? (
        <p className="history-empty">Aucune rencontre enregistrée.</p>
      ) : (
        <>
          <ol
            className="encounter-list"
            ref={list}
            tabIndex={-1}
            data-paginated={pageCount > 1 ? 'true' : undefined}
            aria-label={`Rencontres, de la plus récente à la plus ancienne${pageCount > 1 ? `, page ${page + 1} sur ${pageCount}` : ''}`}
          >
            {rows.slice(first, first + PAGE_SIZE).map((row) => (
              <li className="encounter-row" key={row.id}>
                <time className="encounter-date" dateTime={row.occurredAt}>
                  {formatDate(row.occurredAt, { year: 'numeric' })}
                </time>
                <span className="encounter-tool">
                  <span className="sr-only">Moyen de défense : </span>
                  {defenseNames[row.tool] ?? (row.tool || 'Non renseigné')}
                </span>
                <span
                  className="encounter-interval"
                  aria-label={
                    row.sincePrevious === null
                      ? 'La rencontre précédente n’est pas connue.'
                      : `Avec la rencontre précédente : ${intervalLabel(row.sincePrevious)}`
                  }
                >
                  {intervalLabel(row.sincePrevious)}
                </span>
              </li>
            ))}
          </ol>
          {pageCount > 1 && (
            <nav
              className="history-pagination"
              aria-label="Pages de l'historique"
            >
              <button
                type="button"
                disabled={page === 0}
                onClick={() => changePage(page - 1)}
              >
                Précédent
              </button>
              <span aria-live="polite" aria-atomic="true">
                Page {page + 1} sur {pageCount}
              </span>
              <button
                type="button"
                disabled={page === pageCount - 1}
                onClick={() => changePage(page + 1)}
              >
                Suivant
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  )
}
