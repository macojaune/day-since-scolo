import Image from 'next/image'
import { useId } from 'react'
import type { CSSProperties } from 'react'
import { formatDuration } from '~/game/sandale/engine'
import FootSprite from './FootSprite'
import ScoloSprite from './ScoloSprite'
import { useSandaleGame } from './useSandaleGame'
import styles from './SandaleGame.module.css'

function CloseIcon() {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
}

export default function SandaleGame({ onClose, onLeaderboard }: { onClose: () => void; onLeaderboard: () => void }) {
  const game = useSandaleGame()
  const { frame, mode } = game
  const controlsId = useId()
  const night = Math.floor(frame.elapsedMs / 25000) % 2 === 1

  return <section className={styles.game} aria-label="Mini-jeu de survie à la sandale">
    <div className={styles.hud}>
      <strong data-testid="survival-time" aria-label="Temps de survie">{formatDuration(frame.elapsedMs)}</strong>
      <button className={styles.iconButton} type="button" disabled={mode !== 'playing' && mode !== 'countdown'}
        aria-label="Mettre en pause" onClick={game.pause}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
      </button>
      <button className={styles.iconButton} type="button" aria-label="Fermer le mini-jeu" onClick={onClose}><CloseIcon /></button>
    </div>

    <div ref={game.board} className={`${styles.board} ${night ? styles.night : ''} ${mode === 'playing' ? styles.playing : ''}`}
      data-testid="sandale-board" data-mode={mode} data-night={night} tabIndex={0}
      role="group" aria-label="Protège ton pied" aria-describedby={controlsId}
      onPointerDown={game.onPointerDown} onKeyDown={game.onKeyDown}>
      <svg className={styles.floor} viewBox="0 0 200 156" preserveAspectRatio="none" aria-hidden="true"><path d="M0 52H200M0 104H200M80 0v52m35 0v52m-35 0v52" /></svg>
      <div className={`${styles.goal} ${mode === 'over' ? styles.escaped : ''}`} aria-hidden="true"><FootSprite /></div>

      {frame.bugs.map(bug => <button key={bug.id} type="button" tabIndex={-1}
        className={styles.bug} data-bug-id={bug.id} data-lane={bug.lane}
        aria-label={`Écraser le scolo ${['du haut', 'du milieu', 'du bas'][bug.lane]}`}
        style={{ '--progress': bug.progress, '--lane': bug.lane } as CSSProperties}
        onClick={event => {
          if (event.detail !== 0) return
          const bounds = game.board.current?.getBoundingClientRect()
          const rect = event.currentTarget.getBoundingClientRect()
          if (bounds) game.swing(rect.left - bounds.left + rect.width / 2, rect.top - bounds.top + rect.height / 2, bug.id)
        }}><ScoloSprite variant={bug.variant} /></button>)}

      {frame.impacts.map(impact => <div key={impact.id} className={styles.impact}
        style={{ left: impact.x, top: impact.y }} aria-hidden="true">
        <Image src="/sandale.png" alt="" width={72} height={72} unoptimized draggable={false} />
        {impact.hit && <span>PAF !</span>}
      </div>)}

      {mode === 'countdown' && <div className={styles.countdown} aria-hidden="true"><strong key={game.countdown}>{game.countdown}</strong></div>}
      {mode === 'preparing' && <div className={styles.curtain}>
        {game.startError ? <><h3>Départ indisponible</h3><button className={styles.primary} type="button" title={game.startError} onClick={() => void game.start()}>Réessayer</button></> : <p role="status">On prépare la partie…</p>}
      </div>}
      {mode === 'paused' && <div className={styles.curtain}>
        <h3>Pause</h3>
        <button className={styles.primary} type="button" onClick={game.resume}>Reprendre</button>
      </div>}
      {mode === 'over' && <div className={styles.curtain}>
        <h3>Perdu</h3>
        <p className={styles.finalTime}>{formatDuration(frame.elapsedMs)}</p>
        {game.newRecord && <span className={styles.recordNote}>Record !</span>}
        <div className={styles.resultActions}>
          <button ref={game.replay} className={styles.primary} type="button" onClick={() => void game.start()}>Rejouer</button>
          <button className={styles.rankingButton} type="button" onClick={onLeaderboard}>Classement</button>
        </div>
      </div>}
    </div>

    <div className={styles.record} data-testid="personal-best" title={game.storageAvailable ? 'Record conservé dans ce navigateur' : 'Stockage indisponible, record conservé pendant cette visite'}>
      {game.record ? `Record local ${formatDuration(game.record.elapsedMs)}` : 'Record local : à toi de jouer'}
      <span className={styles.recovery}><span style={{ transform: `scaleX(${1 - frame.recovery})` }} /></span>
    </div>
    <p id={controlsId} className={styles.srOnly}>Clic ou tap pour écraser avant le pied. Au clavier : 1 en haut, 2 au milieu, 3 en bas. Échap pour mettre en pause.</p>
    <span className={styles.srOnly} data-testid="crushed-count">{frame.crushed}</span>
    <p className={styles.srOnly} role="status" aria-live="polite">{mode === 'over' ? 'Perdu.' : mode === 'paused' ? 'Partie en pause.' : mode === 'countdown' ? `Prêt ? ${game.countdown}` : ''}</p>
  </section>
}
