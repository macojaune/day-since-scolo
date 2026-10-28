import { DayPicker, TZDate } from '@daypicker/react'
import { fr } from '@daypicker/react/locale/fr'
import { useEffect, useId, useRef, useState } from 'react'
import { formatDate, GAME_TIMEZONE, localInput } from '~/utils/game-format'
import styles from './AppearanceDateTimePicker.module.css'

type Props = {
  value: string
  onChange: (value: string) => void
  openedAt?: string
  latestAt?: string
  disabled?: boolean
}

const calendarDate = (day: string) =>
  new TZDate(`${day}T00:00:00-04:00`, GAME_TIMEZONE)

export default function AppearanceDateTimePicker({
  value,
  onChange,
  openedAt,
  latestAt,
  disabled = false,
}: Props) {
  const calendarId = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const timeInput = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [day = '', time = ''] = value.split('T')
  const today = localInput(now).slice(0, 10)
  // The API requires an observation strictly after the round opens.
  const earliest = openedAt
    ? localInput(new Date(Math.floor(new Date(openedAt).getTime() / 60_000) * 60_000 + 60_000))
    : undefined
  const minDay = earliest?.slice(0, 10)
  const latest = localInput(latestAt && new Date(latestAt) < now ? new Date(latestAt) : now)
  const maxDay = latest.slice(0, 10)
  const selected = day ? calendarDate(day) : undefined
  const isOpen = open && !disabled

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [isOpen])

  function chooseDate(date: Date) {
    onChange(`${localInput(date).slice(0, 10)}T${time}`)
    setOpen(false)
    timeInput.current?.focus()
  }

  return (
    <div
      ref={root}
      className={styles.picker}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && isOpen) {
          event.preventDefault()
          setOpen(false)
          trigger.current?.focus()
        }
      }}
      onBlur={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setOpen(false)
        }
      }}
    >
      <div className={styles.fields}>
        <div className={styles.field}>
          <label htmlFor="appearance-date">Date de l&apos;apparition</label>
          <button
            id="appearance-date"
            ref={trigger}
            type="button"
            className={styles.dateButton}
            aria-expanded={isOpen}
            aria-controls={calendarId}
            aria-haspopup="dialog"
            aria-describedby="appearance-timezone"
            disabled={disabled}
            onClick={() => {
              setNow(new Date())
              setOpen(!isOpen)
            }}
          >
            <span>
              {selected
                ? formatDate(selected, { year: 'numeric' })
                : 'Choisir une date'}
            </span>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M16 3v4M8 3v4M3 11h18" />
            </svg>
          </button>
        </div>
        <div className={styles.field}>
          <label htmlFor="appearance-time">Heure</label>
          <input
            ref={timeInput}
            id="appearance-time"
            type="time"
            value={time}
            onChange={(event) => onChange(`${day}T${event.target.value}`)}
            min={earliest && day === minDay ? earliest.slice(11, 16) : undefined}
            max={day === maxDay ? latest.slice(11, 16) : undefined}
            step="60"
            required
            disabled={disabled}
            aria-describedby="appearance-timezone"
          />
        </div>
      </div>
      {isOpen && (
        <div
          id={calendarId}
          className={styles.popover}
          role="dialog"
          aria-label="Choisir la date de l’apparition"
        >
          <DayPicker
            mode="single"
            required
            locale={fr}
            timeZone={GAME_TIMEZONE}
            weekStartsOn={1}
            selected={selected}
            onSelect={chooseDate}
            defaultMonth={selected ?? calendarDate(maxDay)}
            startMonth={minDay ? calendarDate(minDay) : undefined}
            endMonth={calendarDate(maxDay)}
            disabled={[
              ...(minDay ? [{ before: calendarDate(minDay) }] : []),
              { after: calendarDate(maxDay) },
            ]}
            today={calendarDate(today)}
            navLayout="around"
            showOutsideDays
            autoFocus
          />
          <div className={styles.shortcuts}>
            <button
              type="button"
              disabled={Boolean(minDay && today < minDay) || today > maxDay}
              onClick={() => chooseDate(calendarDate(today))}
            >
              Aujourd&apos;hui
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                trigger.current?.focus()
              }}
            >
              Fermer
            </button>
          </div>
        </div>
      )}
      <p id="appearance-timezone" className={styles.hint}>
        Heure de Guadeloupe · UTC−4. Indique le moment où tu l&apos;as vu, même
        si tu le déclares plus tard.
      </p>
    </div>
  )
}
