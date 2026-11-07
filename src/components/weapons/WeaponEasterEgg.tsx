import dynamic from 'next/dynamic'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import type { WeaponGame } from '~/game/weapons/engine'
import { gameLabel } from '~/game/weapons/catalog'
import { hasSeenScore, markScoreSeen } from '~/game/sandale/pending-scores'
import { useScoreRecovery } from '../sandale/useScoreRecovery'
import SandaleLeaderboard from '../sandale/SandaleLeaderboard'
import styles from './Weapons.module.css'
const Game = dynamic(() => import('./WeaponGame'), { ssr:false, loading: () => <p role="status">Préparation du jeu…</p> })
export default function WeaponEasterEgg({ game, recordsOpen }: { game: WeaponGame; recordsOpen: boolean }) {
  const [open,setOpen] = useState(false), [ranking,setRanking] = useState(false), [key,setKey] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null), played = useRef(false), seen = useRef(new Set<string>())
  const scores = useScoreRecovery(game)
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal()
    else if (!open && dialog.current?.open) dialog.current.close()
  }, [open])
  useEffect(() => {
    const pending = scores.pending.data
    if (!played.current && pending && !scores.busy && !seen.current.has(pending.id) && (!pending.claimed || !hasSeenScore(pending.id))) {
      seen.current.add(pending.id); if (!recordsOpen) setRanking(true)
    }
    if (ranking && pending?.claimed) markScoreSeen(pending.id)
  }, [scores.pending.data,scores.busy,recordsOpen,ranking])
  return <div className={styles.slot}>
    <button type="button" className={styles.trigger} aria-label={`Jouer avec ${gameLabel(game)}`} onClick={() => { played.current=true;setOpen(true) }}><Image src={`/${game}.png`} width={200} height={200} alt={gameLabel(game)} unoptimized /></button>
    <dialog ref={dialog} className={styles.dialog} aria-label={`Mini-jeu : ${gameLabel(game)}`} onCancel={() => setOpen(false)} onClick={event => { if (event.target===event.currentTarget) { const box=event.currentTarget.getBoundingClientRect(); if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)setOpen(false) } }}>
      {open && <Game key={key} game={game} onClose={() => setOpen(false)} onLeaderboard={() => { setOpen(false);setRanking(true) }} />}
    </dialog>
    <SandaleLeaderboard game={game} open={ranking && !recordsOpen} onClose={() => setRanking(false)} scores={scores} onReplay={() => { setRanking(false);setKey(value=>value+1);setOpen(true) }} />
  </div>
}
