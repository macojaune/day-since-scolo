import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import {
  advanceRun, beatsRecord, bestTarget, createRun, readRecord, RECORD_KEY, strike,
  STRIKE_RECOVERY_MS, type Bug, type Lane, type RecordScore, type Run,
} from '~/game/sandale/engine'
import { queueScore } from '~/game/sandale/pending-scores'
import type { FinishedRun } from '~/game/sandale/protocol'
import { api } from '~/utils/api'

type Mode = 'preparing' | 'countdown' | 'playing' | 'paused' | 'over'
type Impact = { id: number; x: number; y: number; at: number; hit: boolean }
type Frame = { elapsedMs: number; crushed: number; bugs: Bug[]; recovery: number; impacts: Impact[] }
const emptyFrame: Frame = { elapsedMs: 0, crushed: 0, bugs: [], recovery: 0, impacts: [] }

function loadLocalRecord() {
  try { return { score: readRecord(localStorage.getItem(RECORD_KEY)), available: true } }
  catch { return { score: null, available: false } }
}

export function useSandaleGame() {
  const [saved] = useState(loadLocalRecord)
  const [mode, setMode] = useState<Mode>('preparing')
  const [startError, setStartError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(3)
  const [frame, setFrame] = useState<Frame>(emptyFrame)
  const [record, setRecord] = useState<RecordScore | null>(saved.score)
  const [newRecord, setNewRecord] = useState(false)
  const [storageAvailable, setStorageAvailable] = useState(saved.available)
  const board = useRef<HTMLDivElement>(null)
  const replay = useRef<HTMLButtonElement>(null)
  // Initialized by the mount effect before countdown can finish or accept input.
  const run = useRef<Run>(null!)
  const impacts = useRef<Impact[]>([])
  const impactId = useRef(0)
  const previousRecord = useRef<RecordScore | null>(saved.score)
  const finishSaved = useRef(false)
  const token = useRef('')
  const actions = useRef<FinishedRun['actions']>([])
  const booted = useRef(false)
  const { mutateAsync: begin } = api.arcade.start.useMutation()

  const start = useCallback(async () => {
    setMode('preparing')
    setStartError(null)
    try {
      const session = await begin()
      token.current = session.token
      actions.current = []
      run.current = createRun(session.seed)
      impacts.current = []
      finishSaved.current = false
      setNewRecord(false)
      setCountdown(3)
      setFrame(emptyFrame)
      setMode('countdown')
      board.current?.focus({ preventScroll: true })
    } catch (error) { setStartError(error instanceof Error ? error.message : 'Départ indisponible. Réessaie.') }
  }, [begin])

  useEffect(() => { if (!booted.current) { booted.current = true; void start() } }, [start])

  const paint = useCallback(() => {
    const current = run.current
    impacts.current = impacts.current.filter(impact => current.elapsedMs - impact.at < 340)
    setFrame({ elapsedMs: current.elapsedMs, crushed: current.crushed,
      bugs: current.bugs.map(bug => ({ ...bug })),
      recovery: Math.max(0, (current.nextStrikeAt - current.elapsedMs) / STRIKE_RECOVERY_MS),
      impacts: [...impacts.current] })
  }, [])

  const finish = useCallback(() => {
    if (finishSaved.current) return
    finishSaved.current = true
    const score = { elapsedMs: Math.round(run.current.elapsedMs), crushed: run.current.crushed }
    queueScore({ token: token.current, elapsedMs: run.current.elapsedMs, actions: [...actions.current] })
    if (beatsRecord(score, previousRecord.current)) {
      previousRecord.current = score
      setRecord(score)
      setNewRecord(true)
      try { localStorage.setItem(RECORD_KEY, JSON.stringify(score)) }
      catch { setStorageAvailable(false) }
    }
    setMode('over')
  }, [])

  useEffect(() => {
    if (mode !== 'countdown') return
    const timer = window.setTimeout(() => {
      if (countdown > 1) setCountdown(value => value - 1)
      else setMode('playing')
    }, 450)
    return () => window.clearTimeout(timer)
  }, [countdown, mode])

  useEffect(() => {
    if (mode !== 'playing') return
    let request = 0
    let previous = performance.now()
    const tick = (now: number) => {
      const delta = now - previous
      previous = now
      if (document.hidden || delta > 500) { setMode('paused'); return }
      advanceRun(run.current, delta)
      paint()
      if (run.current.status === 'lost') { finish(); return }
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [mode, finish, paint])

  useEffect(() => {
    const pause = () => setMode(current => current === 'playing' || current === 'countdown' ? 'paused' : current)
    const onVisibility = () => { if (document.hidden) pause() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', pause)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', pause)
    }
  }, [])

  useEffect(() => {
    if (mode === 'over') replay.current?.focus({ preventScroll: true })
    if (mode === 'playing') board.current?.focus({ preventScroll: true })
  }, [mode])

  function resume() {
    if (run.current.elapsedMs === 0) { setCountdown(3); setMode('countdown') }
    else setMode('playing')
  }

  function swing(x: number, y: number, bugId?: number) {
    if (mode !== 'playing') return
    const result = strike(run.current, bugId)
    if (!result.accepted) return
    actions.current.push({ at: run.current.elapsedMs, ...(bugId === undefined ? {} : { bugId }) })
    impacts.current.push({ id: ++impactId.current, x, y, at: run.current.elapsedMs, hit: result.hit })
    paint()
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (mode !== 'playing' || !event.isPrimary || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    const bounds = event.currentTarget.getBoundingClientRect()
    const target = (event.target as Element).closest<HTMLElement>('[data-bug-id]')
    swing(event.clientX - bounds.left, event.clientY - bounds.top, target ? Number(target.dataset.bugId) : undefined)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && (mode === 'playing' || mode === 'countdown')) {
      event.preventDefault()
      setMode('paused')
      return
    }
    if (mode !== 'playing' || event.repeat || !['1', '2', '3'].includes(event.key)) return
    event.preventDefault()
    const target = bestTarget(run.current, (Number(event.key) - 1) as Lane)
    const element = target && board.current?.querySelector<HTMLElement>(`[data-bug-id="${target.id}"]`)
    const rect = element?.getBoundingClientRect()
    const bounds = board.current?.getBoundingClientRect()
    if (rect && bounds) swing(rect.left - bounds.left + rect.width / 2,
      rect.top - bounds.top + rect.height / 2, target?.id)
  }

  return { mode, countdown, frame, record, newRecord, storageAvailable, startError, board, replay,
    start, resume, pause: () => setMode('paused'), swing, onPointerDown, onKeyDown }
}
