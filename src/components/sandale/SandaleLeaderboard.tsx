import { useClerk } from '@clerk/nextjs'
import { useEffect, useId, useRef, useState } from 'react'
import { AUTH_RETURN_KEY } from '~/game/sandale/pending-scores'
import { formatDuration } from '~/game/sandale/engine'
import { api } from '~/utils/api'
import type { useScoreRecovery } from './useScoreRecovery'
import LeaderboardShare from './LeaderboardShare'
import styles from './SandaleLeaderboard.module.css'

type Bonus = { key: string; amount: number; total: number; viewerId: string }
export default function SandaleLeaderboard({ open, onClose, onReplay, scores }: {
  open: boolean; onClose: () => void; onReplay: () => void; scores: ReturnType<typeof useScoreRecovery>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const ownRow = useRef<HTMLTableRowElement>(null)
  const titleId = useId()
  const clerk = useClerk()
  const utils = api.useUtils()
  const [offset, setOffset] = useState<number | undefined>()
  const ranking = api.arcade.standings.useQuery({ viewerId: scores.viewerId, offset }, { enabled: open && scores.isLoaded })
  const rewards = api.arcade.leaderboard.useQuery({ viewerId: scores.viewerId }, { enabled: open && scores.isLoaded })
  const attemptedRewards = useRef(new Set<string>())
  const seenBonuses = useRef(new Set<string>())
  const [collectedBonus, setCollectedBonus] = useState<Bonus | null>(null)
  const [toast, setToast] = useState<Bonus | null>(null)
  const { mutate: collectReward, isPending: collecting, error: rewardError } = api.arcade.reward.useMutation({
    onSuccess: async result => {
      if (result.credited > 0 && scores.viewerId) setCollectedBonus({ key: `${scores.viewerId}:${result.total}`, amount: result.credited, total: result.total, viewerId: scores.viewerId })
      await Promise.all([utils.arcade.leaderboard.invalidate(), utils.app.me.invalidate()])
    },
  })
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal()
    else if (!open && dialog.current?.open) dialog.current.close()
    if (!open) setOffset(undefined)
  }, [open])
  useEffect(() => {
    if (!open || !scores.viewerId || !rewards.data?.reward?.available) return
    const key = `${scores.viewerId}:${rewards.data.reward.total}:${rewards.data.reward.available}`
    if (attemptedRewards.current.has(key)) return
    attemptedRewards.current.add(key)
    collectReward({ viewerId: scores.viewerId })
  }, [open, scores.viewerId, rewards.data, collectReward])
  const collected = collectedBonus?.viewerId === scores.viewerId ? collectedBonus : null
  const bonus = scores.bonus && (!collected || scores.bonus.total >= collected.total) ? scores.bonus : collected
  useEffect(() => {
    if (!open || !bonus || bonus.viewerId !== scores.viewerId || seenBonuses.current.has(bonus.key)) return
    const key = `scolo:sandale-bonus-seen:${bonus.key}`
    seenBonuses.current.add(bonus.key)
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1') } catch { /* The server cap remains authoritative with blocked storage. */ }
    setToast(bonus)
  }, [open, bonus, scores.viewerId])
  useEffect(() => {
    if (!open) { setToast(null); return }
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 8000)
    return () => window.clearTimeout(timer)
  }, [open, toast])
  useEffect(() => {
    if (!open || !list.current) return
    const container = list.current
    const row = ownRow.current
    container.scrollTop = offset === undefined && row ? container.scrollTop + row.getBoundingClientRect().top - container.getBoundingClientRect().top - (container.clientHeight - row.clientHeight) / 2 : 0
  }, [open, offset, ranking.data])
  const current = ranking.data?.me ?? scores.pending.data ?? scores.saved
  const visibleBonus = toast?.viewerId === scores.viewerId ? toast : null

  function signIn() {
    try { localStorage.setItem(AUTH_RETURN_KEY, 'true') } catch { /* Durable receipt survives OAuth. */ }
    dialog.current?.close()
    onClose()
    clerk.openSignIn({ forceRedirectUrl: '/#run', signUpForceRedirectUrl: '/#run' })
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose() }} onClose={onClose}
    onClick={event => {
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) onClose()
    }}>
    <header className={styles.header}>
      <h2 id={titleId}>Le classement</h2>
      <button type="button" className={styles.close} aria-label="Fermer le classement" onClick={onClose}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
      </button>
    </header>
    {current && <section className={styles.result} aria-label="Résultat de cette partie">
      <div className={styles.position}><span>Ta place</span><div className={styles.placeValue}><strong>{ranking.data?.me ? `#${ranking.data.me.rank}` : '…'}</strong>
        {visibleBonus && <span key={visibleBonus.key} className={styles.bonus} role="status">+{visibleBonus.amount} Zikak</span>}
      </div></div>
      <div className={styles.time}><span>Ton temps</span><strong>{formatDuration(current.elapsedMs)}</strong></div>
    </section>}
    <section className={styles.saveState} aria-label="Enregistrement de ta partie">
      {scores.busy && <p role="status">Sauvegarde…</p>}
      {scores.claiming && <p role="status">Enregistrement…</p>}
      {scores.pending.data?.otherAccount && <p role="alert">Cette partie appartient à un autre compte. Elle reste conservée pour ce compte.</p>}
      {!scores.isSignedIn && scores.pending.data && !scores.pending.data.otherAccount && <button className={styles.secondary} type="button" disabled={scores.busy} onClick={signIn}>Se connecter pour enregistrer</button>}
      {scores.error && <div role="alert"><p>{scores.error}</p><button className={styles.inline} type="button" onClick={() => void scores.retry()}>Réessayer la sauvegarde</button></div>}
      {scores.pending.error && <p role="alert">La récupération ne répond pas. <button className={styles.inline} type="button" onClick={() => void scores.pending.refetch()}>Réessayer</button></p>}
      {collecting && <p role="status">Crédit en cours…</p>}
      {rewardError && <p role="alert">Le bonus reste disponible. <button className={styles.inline} type="button" onClick={() => scores.viewerId && collectReward({ viewerId: scores.viewerId })}>Réessayer</button></p>}
    </section>
    {ranking.isPending && <p role="status" className={styles.empty}>Chargement du classement…</p>}
    {ranking.error && <div className={styles.empty} role="alert">Le classement est indisponible. <button className={styles.inline} type="button" onClick={() => void ranking.refetch()}>Réessayer</button></div>}
    {ranking.data && (ranking.data.entries.length ? <>
      <div ref={list} className={styles.scrollArea} role="region" aria-label="Joueurs du classement" tabIndex={0}>
        {ranking.data.previousOffset !== null && <button type="button" className={styles.more} onClick={() => setOffset(ranking.data!.previousOffset!)}>Voir les places précédentes</button>}
        <table className={styles.table}>
          <caption className={styles.srOnly}>Classement de cette partie, {ranking.data.total} joueurs</caption>
          <thead><tr><th scope="col">Place</th><th scope="col">Joueur</th><th scope="col">Temps</th></tr></thead>
          <tbody>{ranking.data.entries.map(entry => <tr key={entry.rank} ref={entry.isMe ? ownRow : undefined} className={entry.isMe ? styles.me : undefined} aria-current={entry.isMe ? 'true' : undefined}>
            <td>{entry.rank}</td><th scope="row"><span>{entry.name}</span>{entry.isMe && <small className={styles.you}>toi</small>}</th><td>{formatDuration(entry.elapsedMs)}</td>
          </tr>)}</tbody>
        </table>
        {ranking.data.nextOffset !== null && <button type="button" className={styles.more} onClick={() => setOffset(ranking.data!.nextOffset!)}>Voir les places suivantes</button>}
      </div>
    </> : <p className={styles.empty}>La première place t’attend.</p>)}
    <div className={styles.actions}><button type="button" className={styles.secondary} onClick={onReplay}>Rejouer</button><LeaderboardShare board={ranking.data} /></div>
  </dialog>
}
