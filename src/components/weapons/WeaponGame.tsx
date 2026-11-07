import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { advanceWeapon, createWeaponRun, recordWeaponInput, STEP, type Input, type WeaponGame as Game, type WeaponRun } from '~/game/weapons/engine'
import { gameLabel, gameScore } from '~/game/weapons/catalog'
import { queueScore } from '~/game/sandale/pending-scores'
import { api } from '~/utils/api'
import ScoloSprite from '../sandale/ScoloSprite'
import styles from './Weapons.module.css'

const clone = (run: WeaponRun) => ({ ...run, targets: run.targets.map(t => ({ ...t })), shots: run.shots.map(t => ({ ...t })), marks: [...run.marks] })
export default function WeaponGame({ game, onClose, onLeaderboard }: { game: Game; onClose: () => void; onLeaderboard: () => void }) {
  const [frame, setFrame] = useState(() => createWeaponRun(game, 1))
  const [mode, setMode] = useState<'ready' | 'preparing' | 'playing' | 'paused' | 'over'>('ready')
  const [error, setError] = useState<string | null>(null)
  const [angle, setAngle] = useState(90), [power, setPower] = useState(65)
  const run = useRef(createWeaponRun(game, 1)), token = useRef(''), actions = useRef<Input[]>([])
  const drag = useRef<{ x: number; y: number } | null>(null)
  const mounted = useRef(true), arena = useRef<SVGSVGElement>(null), launch = useRef<HTMLButtonElement>(null)
  const { mutateAsync: begin } = api.arcade.start.useMutation()
  const title = useId(), instructions = useId()
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const paint = useCallback(() => setFrame(clone(run.current)), [])
  const input = useCallback((value: Omit<Input, 'at'>) => {
    if (recordWeaponInput(run.current, actions.current, value)) paint()
  }, [paint])
  const pause = useCallback(() => {
    if (run.current.game === 'digrain' && run.current.fire) input({ fire: false })
    drag.current = null
    setMode(value => value === 'playing' ? 'paused' : value)
  }, [input])
  useEffect(() => {
    const hide = () => { if (document.hidden) pause() }
    window.addEventListener('blur', pause); document.addEventListener('visibilitychange', hide)
    return () => { window.removeEventListener('blur', pause); document.removeEventListener('visibilitychange', hide) }
  }, [pause])
  useEffect(() => {
    if (mode !== 'playing') return
    let previous = performance.now(), accumulated = 0, request = 0
    const tick = (now: number) => {
      accumulated += Math.min(100, now - previous); previous = now
      const steps = Math.floor(accumulated / STEP); accumulated -= steps * STEP
      advanceWeapon(run.current, run.current.tick + steps * STEP)
      paint()
      if (run.current.status === 'lost') {
        queueScore({ token: token.current, elapsedMs: run.current.tick, actions: [...actions.current] }, game)
        setMode('over'); return
      }
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [mode, game, paint])
  async function start() {
    setMode('preparing'); setError(null)
    try {
      const session = await begin({ game })
      if (!mounted.current) return
      token.current = session.token; actions.current = []; run.current = createWeaponRun(game, session.seed)
      paint(); setMode('playing'); arena.current?.focus()
    } catch (cause) { if (mounted.current) { setError(cause instanceof Error ? cause.message : 'Réessaie dans un instant.'); setMode('ready') } }
  }
  const point = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: (event.clientX - bounds.left) * 320 / bounds.width, y: (event.clientY - bounds.top) * 400 / bounds.height }
  }
  function aim(event: PointerEvent<SVGSVGElement>) {
    if (mode !== 'playing') return
    const p = point(event)
    if (game === 'digrain') { input({ x: Math.round(Math.max(18, Math.min(302, p.x))) }); return }
    if (!drag.current) return
    const dx = drag.current.x - p.x, dy = drag.current.y - p.y
    setAngle(Math.round(Math.max(15, Math.min(165, Math.atan2(-dy, dx) * 180 / Math.PI))))
    setPower(Math.round(Math.max(10, Math.min(100, Math.hypot(dx, dy) * .8))))
  }
  const label = game === 'digrain' ? 'Invasion au Digrain' : 'Le lancer de coutelas'
  return <section className={styles.game} aria-labelledby={title}>
    <header><div><h3 id={title}>{label}</h3><p>{game === 'digrain' ? 'Vise. Pulvérise. Relâche pour recharger.' : 'Choisis ton angle. Dose la puissance.'}</p></div><button type="button" onClick={onClose} aria-label="Fermer le mini-jeu">×</button></header>
    <div className={styles.hud}><strong>{gameScore(game, { elapsedMs: frame.tick, crushed: frame.hits, points: frame.score })}</strong><span>{game === 'digrain' ? `${frame.lives} vies · vague ${frame.wave}` : `${frame.attempts} lancers`}</span><button type="button" onClick={mode === 'paused' ? () => setMode('playing') : pause} disabled={mode !== 'playing' && mode !== 'paused'}>{mode === 'paused' ? 'Reprendre' : 'Pause'}</button></div>
    <div className={styles.arena}>
      <svg ref={arena} viewBox="0 0 320 400" tabIndex={0} role="group" aria-label={`Terrain pour ${gameLabel(game)}`} aria-describedby={instructions}
        data-testid={`${game}-board`} data-mode={mode} onKeyDown={event => {
          if (event.key === 'Escape' && mode === 'playing') { event.preventDefault(); pause() }
          if (mode !== 'playing' || game !== 'digrain') return
          if (['ArrowLeft', 'ArrowRight', ' '].includes(event.key)) event.preventDefault()
          if (event.key === 'ArrowLeft') input({ x: Math.max(18, run.current.x - 12) })
          if (event.key === 'ArrowRight') input({ x: Math.min(302, run.current.x + 12) })
          if (event.key === ' ' && !event.repeat) input({ fire: true })
        }} onKeyUp={event => { if (event.key === ' ' && game === 'digrain' && mode === 'playing') input({ fire: false }) }}
        onPointerDown={event => {
          if (mode !== 'playing' || !event.isPrimary || event.button !== 0) return
          event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
          if (game === 'coutelas') drag.current = point(event)
          else { aim(event); input({ fire: true }) }
        }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) aim(event) }}
        onPointerUp={event => {
          if (mode === 'playing') {
            if (game === 'digrain') input({ fire: false })
            else if (drag.current) input({ angle, power })
          }
          drag.current = null
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        }} onPointerCancel={() => { drag.current = null; if (mode === 'playing' && game === 'digrain') input({ fire: false }) }}>
        <rect width="320" height="400" fill={game === 'digrain' ? '#141414' : '#493622'} />
        {game === 'coutelas' && <g stroke="#b98b49" opacity=".35" fill="none"><path d="M0 100H320M0 200H320M0 300H320M80 0V100M240 100V200M80 200V300" /><circle cx="160" cy="170" r="116" /><circle cx="160" cy="170" r="65" /></g>}
        {frame.targets.map(bug => { const width = game === 'digrain' ? 44 : Math.max(9, 20 - frame.hits * .6) * 3.2; return <svg key={bug.id} x={bug.x - width / 2} y={bug.y - 13} width={width} height="26" viewBox="0 0 160 56"><ScoloSprite variant={bug.id % 5} /></svg> })}
        {frame.marks.map(mark => <svg key={mark.id} x={mark.x - 28} y={mark.y - 6} width="56" height="12" viewBox="0 210 500 90" opacity=".5" transform={`rotate(-25 ${mark.x} ${mark.y})`}><image href="/coutelas.png" width="500" height="500" /></svg>)}
        {frame.shots.map((shot, i) => game === 'digrain' ? <path key={i} d={`M${shot.x} ${shot.y}v12`} stroke="#facc15" strokeWidth="4" strokeLinecap="round" /> : <svg key={i} x={shot.x - 32} y={shot.y - 6} width="64" height="12" viewBox="0 210 500 90" transform={`rotate(${Math.atan2(shot.vy, shot.vx) * 180 / Math.PI} ${shot.x} ${shot.y})`}><image href="/coutelas.png" width="500" height="500" /></svg>)}
        {game === 'digrain' ? <><path d="M0 350H320" stroke="#facc15" opacity=".35" strokeDasharray="4 5" /><image href="/digrain.png" x={frame.x - 16} y="352" width="32" height="46" /></> : <><path d={`M160 370l${Math.cos(angle * Math.PI / 180) * 36} ${-Math.sin(angle * Math.PI / 180) * 36}`} stroke="#facc15" strokeWidth="2" strokeDasharray="3 4" /><svg x="128" y="364" width="64" height="12" viewBox="0 210 500 90" transform={`rotate(${-angle} 160 370)`}><image href="/coutelas.png" width="500" height="500" /></svg></>}
      </svg>
      {mode !== 'playing' && <div className={styles.curtain}>
        <h4>{mode === 'over' ? 'Fin de partie' : mode === 'paused' ? 'Pause' : label}</h4>
        <p>{mode === 'over' ? gameScore(game, { elapsedMs: frame.tick, crushed: frame.hits, points: frame.score }) : game === 'digrain' ? 'Maintiens pour tirer, glisse pour viser. Si la bombe se vide, relâche.' : 'Tire en arrière et relâche pour lancer. Trois essais par cible.'}</p>
        {error && <p role="alert">{error}</p>}
        <button ref={launch} type="button" disabled={mode === 'preparing'} onClick={mode === 'paused' ? () => setMode('playing') : () => void start()}>{mode === 'preparing' ? 'Préparation…' : mode === 'paused' ? 'Reprendre' : mode === 'over' ? 'Rejouer' : 'Commencer'}</button>
        {mode === 'over' && <button type="button" onClick={onLeaderboard}>Classement</button>}
      </div>}
    </div>
    {game === 'digrain' ? <div className={styles.controls}>
      <label>Pression : {Math.round(frame.pressure)} %<meter value={frame.pressure} min="0" max="100" /></label>
      <label>Position<input type="range" min="18" max="302" value={frame.x} disabled={mode !== 'playing'} onChange={event => input({ x: Number(event.target.value) })} /></label>
      <button type="button" disabled={mode !== 'playing'} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); input({ fire: true }) }} onPointerUp={() => input({ fire: false })} onPointerCancel={() => input({ fire: false })} onKeyDown={event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); input({ fire: true }) } }} onKeyUp={event => { if ([' ', 'Enter'].includes(event.key)) input({ fire: false }) }}>Pulvériser</button>
    </div> : <div className={styles.controls}>
      <label>Angle : {angle}°<input type="range" min="15" max="165" value={angle} onChange={event => setAngle(Number(event.target.value))} /></label>
      <label>Puissance : {power} %<input type="range" min="10" max="100" value={power} onChange={event => setPower(Number(event.target.value))} /></label>
      <button type="button" disabled={mode !== 'playing' || !!frame.shots.length || !!frame.nextTarget} onClick={() => input({ angle, power })}>Lancer</button>
    </div>}
    <p id={instructions} className={styles.instructions}>{game === 'digrain' ? 'Clavier : flèches pour viser, espace pour tirer. Trois minutes maximum.' : 'Glisse en arrière pour armer, relâche pour lancer. Ou règle les curseurs puis choisis Lancer. Trois minutes maximum.'}</p>
    <span role="status" className={styles.srOnly}>{mode === 'over' ? 'Partie terminée.' : mode === 'paused' ? 'Partie en pause.' : ''}</span>
  </section>
}
