import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const explanation =
  'Les Zikak sont tes points de jeu. Tu en reçois 3 pour commencer. Aucun argent réel.'

export default function ZikakLabel({
  showIcon = true,
}: {
  showIcon?: boolean
}) {
  const tooltipId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const tooltip = useRef<HTMLSpanElement>(null)
  const pinned = useRef(false)
  const closeTimer = useRef<number | null>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{
    left: number
    top: number
    fontFamily: string
  } | null>(null)

  function cancelClose() {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = null
  }

  function close() {
    cancelClose()
    pinned.current = false
    setOpen(false)
    setPosition(null)
  }

  function show() {
    cancelClose()
    setOpen(true)
  }

  function leave() {
    cancelClose()
    if (pinned.current || document.activeElement === trigger.current) return
    // Let the pointer cross the small gap without dismissing readable content.
    closeTimer.current = window.setTimeout(close, 120)
  }

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    },
    []
  )

  useLayoutEffect(() => {
    if (!open) return

    function place() {
      if (!trigger.current || !tooltip.current) return
      const anchor = trigger.current.getBoundingClientRect()
      const fontFamily = getComputedStyle(trigger.current).fontFamily
      tooltip.current.style.fontFamily = fontFamily
      const box = tooltip.current.getBoundingClientRect()
      const margin = 12
      const gap = 8
      const left = Math.max(
        margin,
        Math.min(
          anchor.left + anchor.width / 2 - box.width / 2,
          window.innerWidth - box.width - margin
        )
      )
      const above = anchor.top - box.height - gap
      const top =
        above >= margin
          ? above
          : Math.max(
              margin,
              Math.min(
                anchor.bottom + gap,
                window.innerHeight - box.height - margin
              )
            )
      setPosition({ left, top, fontFamily })
    }

    function dismiss() {
      pinned.current = false
      setOpen(false)
      setPosition(null)
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') dismiss()
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target
      if (
        target instanceof Node &&
        !trigger.current?.contains(target) &&
        !tooltip.current?.contains(target)
      )
        dismiss()
    }

    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  return (
    <>
      <button
        ref={trigger}
        className="zikak-label"
        type="button"
        aria-label="Zikak, c'est quoi ?"
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch') show()
        }}
        onPointerLeave={leave}
        onFocus={show}
        onBlur={close}
        onClick={() => {
          cancelClose()
          pinned.current = !pinned.current
          if (pinned.current) setOpen(true)
          else close()
        }}
      >
        Zikak
        {showIcon && (
          <svg
            width="13"
            height="13"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <circle
              cx="10"
              cy="10"
              r="7.5"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M10 9v5M10 6v.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>
      {open &&
        createPortal(
          <span
            ref={tooltip}
            id={tooltipId}
            role="tooltip"
            className="zikak-tooltip"
            style={{
              left: position?.left ?? 0,
              top: position?.top ?? 0,
              fontFamily: position?.fontFamily,
              visibility: position ? 'visible' : 'hidden',
            }}
            onPointerEnter={cancelClose}
            onPointerLeave={leave}
          >
            {explanation}
          </span>,
          document.body
        )}
      <style jsx>{`
        .zikak-label {
          display: inline-flex;
          align-items: baseline;
          gap: 4px;
          padding: 2px 0;
          border: 0;
          border-radius: 2px;
          color: inherit;
          background: transparent;
          font: inherit;
          line-height: inherit;
          vertical-align: baseline;
          text-decoration: underline dotted;
          text-underline-offset: 4px;
          cursor: help;
        }
        .zikak-label svg {
          align-self: center;
          flex: none;
        }
        .zikak-label:focus-visible {
          outline: 2px solid currentColor;
          outline-offset: 4px;
        }
        .zikak-tooltip {
          position: fixed;
          z-index: 1000;
          display: block;
          width: min(280px, calc(100vw - 24px));
          max-height: calc(100vh - 24px);
          overflow: auto;
          padding: 13px 15px;
          border: 1px solid #facc15;
          border-radius: 8px;
          background: #000;
          color: #fff;
          font-size: 14px;
          font-weight: 400;
          line-height: 1.5;
          letter-spacing: normal;
          text-align: left;
          text-transform: none;
        }
      `}</style>
    </>
  )
}
