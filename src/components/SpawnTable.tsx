'use client'
import { useState, useCallback } from 'react'

const ITEMS_PER_PAGE = 7

const SpawnTable = ({
  data,
}: {
  data: { id: number; createdAt: string; tool?: string }[]
}) => {
  const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE)

  const showMore = useCallback(() => {
    setDisplayCount((prevCount) =>
      Math.min(prevCount + ITEMS_PER_PAGE, data.length)
    )
  }, [data.length])

  return (
    <div>
      <table className="table-fixed">
        <thead>
          <tr className="border-b border-amber-100/70">
            <th className="border-r border-amber-100/25 pr-4 text-amber-500">
              Dernières rencontres
            </th>
            <th className="pl-4 text-amber-500">Arme</th>
          </tr>
        </thead>
        <tbody>
          {data.slice(1, displayCount).map((item, index) => {
            const date = new Date(item.createdAt)
            const prevDate = new Date(data[index]!.createdAt)
            const diffTime = Math.abs(date.getTime() - prevDate.getTime())
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
            const diffHours = Math.floor(diffTime / (1000 * 60 * 60))
            return (
              <tr className="border-b border-amber-100/25" key={item.id}>
                <td className="border-r border-amber-100/25 px-2 text-justify text-white">
                  {date.toLocaleString('fr-Fr', {
                    timeZone: 'America/New_York',
                    day: '2-digit',
                    month: 'long',
                    hour: '2-digit',
                    minute: 'numeric',
                    hourCycle: 'h24',
                  })}
                  <span className="text-xs text-amber-500">
                    {' '}
                    après{' '}
                    {diffDays > 0
                      ? `${diffDays} jour${diffDays !== 1 ? 's' : ''}`
                      : `${diffHours} heure${diffHours !== 1 ? 's' : ''}`}
                  </span>
                </td>
                <td className="pl-4 text-amber-300">
                  {item?.tool ?? 'Digrain'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {displayCount < data.length && (
        <div className="mt-2 text-center">
          <button
            onClick={showMore}
            className="text-amber-500 underline underline-offset-4 hover:text-amber-400"
          >
            Voir les {data.length - displayCount} autres
          </button>
        </div>
      )}
    </div>
  )
}

export default SpawnTable
