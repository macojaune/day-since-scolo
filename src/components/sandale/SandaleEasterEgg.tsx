import dynamic from 'next/dynamic'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { AUTH_RETURN_KEY, hasSeenScore, markScoreSeen } from '~/game/sandale/pending-scores'
import SandaleLeaderboard from './SandaleLeaderboard'
import { useScoreRecovery } from './useScoreRecovery'
import styles from './SandaleGame.module.css'

const SandaleGame = dynamic(() => import('./SandaleGame'), {
  ssr: false,
  loading: () => <span className={styles.loading} role="status">La sandale arrive…</span>,
})

export default function SandaleEasterEgg() {
  const [open, setOpen] = useState(false)
  const [rankingOpen, setRankingOpen] = useState(false)
  const [gameKey, setGameKey] = useState(0)
  const scores = useScoreRecovery()
  const trigger = useRef<HTMLButtonElement>(null)
  const playedHere = useRef(false)
  const recovered = useRef(new Set<string>())
  useEffect(() => {
    const pending = scores.pending.data
    if (!playedHere.current && pending && !scores.busy && !recovered.current.has(pending.id) && (!pending.claimed || !hasSeenScore(pending.id))) {
      recovered.current.add(pending.id)
      setRankingOpen(true)
    }
  }, [scores.pending.data, scores.busy])
  useEffect(() => { if (rankingOpen && scores.pending.data?.claimed) markScoreSeen(scores.pending.data.id) }, [rankingOpen, scores.pending.data])
  useEffect(() => {
    if (!scores.isSignedIn) return
    let returning = false
    try { returning = localStorage.getItem(AUTH_RETURN_KEY) === 'true'; if (returning) localStorage.removeItem(AUTH_RETURN_KEY) } catch { /* Receipt recovery does not depend on this UI preference. */ }
    if (returning) setRankingOpen(true)
  }, [scores.isSignedIn])
  return <div className={styles.slot} data-testid="sandale-slot">
    {open ? <SandaleGame key={gameKey} onLeaderboard={() => setRankingOpen(true)} onClose={() => {
      setOpen(false)
      requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }))
    }} /> : <button ref={trigger} className={styles.trigger} type="button"
      aria-label="Jouer à la sandale" title="Jouer à la sandale" onClick={() => { playedHere.current = true; setOpen(true) }}>
      <Image src="/sandale.png" width={200} height={200} alt="Sandale" unoptimized />
    </button>}
    <SandaleLeaderboard open={rankingOpen} onClose={() => setRankingOpen(false)} scores={scores} onReplay={() => { setRankingOpen(false); setGameKey(value => value + 1); setOpen(true) }} />
  </div>
}
