import { SignInButton, useAuth } from '@clerk/nextjs'
import Head from 'next/head'
import Link from 'next/link'
import { useRef, useState, type FormEvent } from 'react'
import AppearanceDateTimePicker from '~/components/AppearanceDateTimePicker'

import { api, type RouterInputs, type RouterOutputs } from '~/utils/api'
import {
  formatDistance,
  formatDate,
  formatInstant,
  formatPoints,
  fromLocalInput,
} from '~/utils/game-format'

type SettlementInput = RouterInputs['app']['previewSettlement']
type Settlement = RouterOutputs['app']['previewSettlement']
type SettlementReceipt = RouterOutputs['app']['settleRound']
type HistoricalInput = RouterInputs['app']['addHistoricalAppearance']
type HistoricalAppearance = RouterOutputs['app']['addHistoricalAppearance']
type Round = RouterOutputs['app']['game']['round']
type Preview = { input: SettlementInput; result: Settlement; revision: string }

const tools: { value: SettlementInput['tool']; label: string }[] = [
  { value: 'sandale', label: 'La sandale' },
  { value: 'coutelas', label: 'Le coutelas' },
  { value: 'digrain', label: 'Le Digrain' },
  { value: 'capes', label: 'Le Capes' },
]

function roundRevision(round: Round) {
  return JSON.stringify([round.id, round.pot, round.predictionCount])
}

export default function AdminPage() {
  const { isLoaded, isSignedIn, userId } = useAuth()
  const game = api.app.game.useQuery()

  return (
    <div className="scolo-app" data-direction="veille">
      <Head>
        <title>Déclarer une apparition · BÈT a milpat</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      {game.data?.isSimulated && (
        <div className="sandbox-note">
          {game.data.environment === 'dev' ? 'Environnement DEV' : 'Bac à sable local'} · Zikak de test
        </div>
      )}
      <main className="page-shell admin-page">
        <header className="admin-header">
          <Link href="/" className="button">
            ← Retour au jeu
          </Link>
          <p className="admin-eyebrow">Le journal de BÈT a milpat</p>
          <h1>Une nouvelle rencontre ?</h1>
          <p>
            Indique quand tu as vu le scolo. Règle la manche en cours ou complète
            le journal avec une rencontre plus ancienne.
          </p>
        </header>

        {!isLoaded ? (
          <p role="status">On vérifie ta connexion…</p>
        ) : !isSignedIn ? (
          <section className="admin-panel" aria-labelledby="admin-signin-title">
            <h2 id="admin-signin-title">Connecte-toi pour continuer.</h2>
            <p>Seul le compte administrateur peut déclarer une apparition.</p>
            <SignInButton mode="redirect">
              <button className="button button-primary" type="button">
                Me connecter
              </button>
            </SignInButton>
          </section>
        ) : (
          <AdminSession key={userId} userId={userId ?? ''} />
        )}
      </main>
      <style jsx global>{`
        .admin-page {
          max-width: 960px;
          padding-top: 36px;
          padding-bottom: 80px;
        }
        .admin-page .admin-header {
          margin-bottom: 36px;
          max-width: 720px;
        }
        .admin-page .admin-header h1 {
          font-size: clamp(2rem, 6vw, 3.6rem);
          line-height: 1.05;
          margin: 12px 0 18px;
        }
        .admin-page .admin-header p,
        .admin-page .admin-panel p {
          line-height: 1.65;
        }
        .admin-page .admin-eyebrow {
          font-size: 0.8rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-top: 30px;
        }
        .admin-page .admin-panel {
          padding: clamp(20px, 4vw, 32px);
          border: 1px solid currentColor;
          border-radius: 16px;
          margin-top: 24px;
        }
        .admin-page .admin-panel h2 {
          font-size: 1.4rem;
          font-weight: 700;
          margin-bottom: 12px;
        }
        .admin-page .admin-panel h3 {
          font-size: 1.05rem;
          font-weight: 700;
          margin: 28px 0 12px;
        }
        .admin-page .admin-form {
          display: grid;
          gap: 22px;
          margin-top: 26px;
        }
        .admin-page .admin-field {
          display: grid;
          gap: 8px;
        }
        .admin-page .admin-field label {
          font-weight: 600;
        }
        .admin-page .admin-field input,
        .admin-page .admin-field select {
          width: 100%;
          min-height: 48px;
          padding: 11px 14px;
          border: 1px solid currentColor;
          border-radius: 8px;
          background: transparent;
          color: inherit;
          font: inherit;
          color-scheme: light dark;
        }
        .admin-page .admin-field select option {
          color: #17221e;
          background: #fff;
        }
        .admin-page .admin-field small,
        .admin-page .admin-muted {
          font-size: 0.85rem;
          opacity: 0.8;
        }
        .admin-page .admin-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 22px;
          align-items: center;
        }
        .admin-page .admin-actions .button {
          white-space: normal;
          text-align: center;
        }
        .admin-page .admin-mode {
          padding: 18px 20px;
          border: 1px solid #585043;
          border-radius: 10px;
          margin-bottom: 24px;
        }
        .admin-page .admin-mode legend {
          padding: 0 8px;
          font-weight: 700;
        }
        .admin-page .admin-mode .admin-actions { margin-top: 4px; }
        .admin-page .admin-mode button[aria-pressed='true'] {
          background: #facc15;
          color: #141414;
          border-color: #facc15;
        }
        .admin-page .admin-totals {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 20px;
          margin: 24px 0;
        }
        .admin-page .admin-totals dt {
          font-size: 0.85rem;
          margin-bottom: 6px;
        }
        .admin-page .admin-totals dd {
          font-size: clamp(1.3rem, 4vw, 2rem);
          font-weight: 700;
        }
        .admin-page .admin-ticket-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        .admin-page .admin-ticket-list li {
          display: flex;
          justify-content: space-between;
          align-items: start;
          gap: 20px;
          padding: 15px 0;
          border-bottom: 1px solid
            color-mix(in srgb, currentColor 20%, transparent);
        }
        .admin-page .admin-ticket-list time {
          display: block;
          font-size: 0.9rem;
          margin-top: 4px;
        }
        .admin-page .admin-ticket-list .admin-payout {
          white-space: nowrap;
        }
        .admin-page .admin-success {
          border-width: 2px;
        }
        .admin-page .admin-success > h2 {
          margin-top: 0;
        }
        .admin-page button:disabled,
        .admin-page input:disabled,
        .admin-page select:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .admin-page :focus-visible {
          outline: 3px solid currentColor;
          outline-offset: 4px;
        }
        @media (max-width: 480px) {
          .admin-page .admin-totals {
            grid-template-columns: 1fr;
          }
          .admin-page .admin-ticket-list li {
            flex-direction: column;
            gap: 8px;
          }
          .admin-page .admin-actions .button {
            width: 100%;
          }
        }
      `}</style>
    </div>
  )
}

function AdminSession({ userId }: { userId: string }) {
  const utils = api.useUtils()
  const [receipt, setReceipt] = useState<SettlementReceipt | null>(null)
  const [historyReceipt, setHistoryReceipt] = useState<HistoricalAppearance | null>(null)
  const me = api.app.me.useQuery(
    { viewerId: userId },
    {
      enabled: Boolean(userId),
      retry: false,
      refetchOnMount: 'always',
    }
  )
  // A cached role from a previous account must never reveal this form.
  const allowed = me.isFetchedAfterMount && me.data?.isAdmin === true
  const game = api.app.game.useQuery(undefined, {
    enabled: allowed,
    refetchInterval: allowed ? 15000 : false,
  })

  async function settled(result: SettlementReceipt) {
    setHistoryReceipt(null)
    setReceipt(result)
    await Promise.all([utils.app.game.invalidate(), utils.app.me.invalidate(), utils.app.pointSyncStatus.invalidate()])
  }

  async function historyAdded(result: HistoricalAppearance) {
    setReceipt(null)
    setHistoryReceipt(result)
    await utils.app.game.invalidate()
  }

  if (me.error) {
    return (
      <section className="admin-panel error-message" role="alert">
        <p>{me.error.message}</p>
        <button
          className="button"
          type="button"
          onClick={() => void me.refetch()}
        >
          Réessayer
        </button>
      </section>
    )
  }

  if (!me.isFetchedAfterMount || me.isPending) {
    return <p role="status">On vérifie tes droits…</p>
  }

  if (!allowed) {
    return (
      <section className="admin-panel" aria-labelledby="admin-denied-title">
        <h2 id="admin-denied-title">Cette page est réservée à Marvin.</h2>
        <p>
          Tu peux suivre les résultats et poser tes pronostics depuis le jeu.
        </p>
        <Link href="/" className="button button-primary">
          Retourner jouer
        </Link>
      </section>
    )
  }

  return (
    <>
      <PointSyncPanel />
      {historyReceipt && (
        <section className="admin-panel admin-success" role="status" aria-labelledby="history-success-title">
          <h2 id="history-success-title">Rencontre ajoutée à l’historique.</h2>
          <p>Le {formatInstant(historyReceipt.occurredAt)} · {tools.find((tool) => tool.value === historyReceipt.tool)?.label ?? historyReceipt.tool}.</p>
          <p>La manche reste ouverte. Les paris, les soldes et la cagnotte sont inchangés.</p>
          <Link href="/#rencontres" className="button">Voir les rencontres</Link>
        </section>
      )}
      {receipt && (
        <section
          className="admin-panel admin-success"
          role="status"
          aria-labelledby="settlement-success-title"
        >
          <h2 id="settlement-success-title">
            Apparition enregistrée. La manche est réglée.
          </h2>
          {receipt.publication && receipt.publication.status !== 'disabled' && (
            <p>
              {receipt.publication.status === 'sent'
                ? 'Le tweet a été publié sur X.'
                : receipt.publication.status === 'failed'
                  ? 'Le tweet n’a pas été publié. L’apparition et les gains sont bien enregistrés.'
                  : 'La publication sur X reste à vérifier. Ne republie pas avant vérification : l’apparition et les gains sont bien enregistrés.'}
            </p>
          )}
          <p>
            Le {formatInstant(receipt.observedAt)} ·{' '}
            {tools.find((tool) => tool.value === receipt.tool)?.label ??
              receipt.tool}
            .
          </p>
          <p>
            <strong>{formatPoints(receipt.pot)} Zikak distribués</strong>
            {' · '}
            {formatPoints(receipt.totalRefunded)} Zikak remboursés.
          </p>
          {receipt.totalReplayBonus > 0 && (
            <p>
              {formatPoints(receipt.totalReplayBonus)} Zikak ajoutés aux joueurs
              perdants sans solde pour rejouer.
            </p>
          )}
          <p>
            {receipt.nextRoundId
              ? 'La manche suivante est ouverte. Les prochains pronostics peuvent commencer.'
              : 'Le tableau du jeu est en cours de mise à jour.'}
          </p>
          <Link href="/" className="button">
            Voir le jeu à jour
          </Link>
        </section>
      )}
      {game.isPending && <p role="status">On charge la manche en cours…</p>}
      {game.error && (
        <section className="admin-panel error-message" role="alert">
          <p>{game.error.message}</p>
          <button
            className="button"
            type="button"
            onClick={() => void game.refetch()}
          >
            Actualiser la manche
          </button>
        </section>
      )}
      {game.data && (
        <SettlementForm
          key={game.data.round.id}
          round={game.data.round}
          onSettled={settled}
          onHistoryAdded={historyAdded}
          alreadySettled={receipt?.roundId === game.data.round.id}
        />
      )}
    </>
  )
}

function PointSyncPanel() {
  const status = api.app.pointSyncStatus.useQuery(undefined, { refetchInterval: 15000, retry: false })
  const retry = api.app.retryPointSync.useMutation({ onSuccess: () => status.refetch().then(() => undefined) })
  if (!status.data?.enabled && !status.error) return null
  const waiting = (status.data?.pending ?? 0) > 0
  const blocked = (status.data?.blocked ?? 0) > 0
  const awaitingIdentity = status.data?.awaitingIdentity ?? 0
  return (
    <section className="admin-panel" aria-labelledby="point-sync-title">
      <h2 id="point-sync-title">Transmission des points à Zikak</h2>
      <p role="status">
        {status.error ? 'Impossible de vérifier la transmission des points.'
          : awaitingIdentity > 0 ? `${awaitingIdentity} joueur${awaitingIdentity>1?'s attendent':' attend'} un rapprochement dans Zikak. Les points sont conservés ; les autres joueurs continuent.`
          : blocked ? 'L’envoi à Zikak est bloqué. Les gains restent enregistrés dans le jeu.'
            : waiting ? 'Les points attendent leur confirmation par Zikak. La transmission reprend automatiquement.'
              : status.data?.sent ? 'Les points des manches réglées ont été transmis à Zikak.'
                : 'Les points seront transmis à la prochaine apparition.'}
      </p>
      {awaitingIdentity>0 && <p><a href="https://zikak-dev.marvinl.com/members" target="_blank" rel="noreferrer">Vérifier les rapprochements dans Zikak</a></p>}
      {(waiting || blocked || awaitingIdentity>0) && <button type="button" className="button" disabled={retry.isPending} onClick={() => retry.mutate()}>
        {retry.isPending ? 'Relance…' : 'Relancer la transmission'}
      </button>}
      {retry.error && <p role="alert">La relance a échoué. Les points à transmettre sont conservés.</p>}
    </section>
  )
}

function SettlementForm({
  round,
  onSettled,
  onHistoryAdded,
  alreadySettled,
}: {
  round: Round
  onSettled: (result: SettlementReceipt) => Promise<void>
  onHistoryAdded: (result: HistoricalAppearance) => Promise<void>
  alreadySettled: boolean
}) {
  const [mode, setMode] = useState<'settle' | 'history'>('settle')
  const [observedAt, setObservedAt] = useState('')
  const [tool, setTool] = useState<SettlementInput['tool']>('sandale')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [historyPreview, setHistoryPreview] = useState<HistoricalInput | null>(null)
  const [validation, setValidation] = useState<string | null>(null)
  const editVersion = useRef(0)
  const confirmationInFlight = useRef(false)
  const previewRequest = api.app.previewSettlement.useMutation()
  const settlement = api.app.settleRound.useMutation()
  const history = api.app.addHistoricalAppearance.useMutation()
  const busy =
    previewRequest.isPending || settlement.isPending || history.isPending || alreadySettled
  const instant = observedAt ? fromLocalInput(observedAt) : null
  const validInstant = instant !== null && Number.isFinite(instant.getTime())
  const sameFields =
    preview !== null &&
    validInstant &&
    preview.input.observedAt.getTime() === instant.getTime() &&
    preview.input.tool === tool &&
    preview.input.roundId === round.id
  const upToDate = preview?.revision === roundRevision(round)
  const canConfirm = sameFields && upToDate && !busy
  const roundChanged = preview !== null && !upToDate

  function edited() {
    editVersion.current++
    setPreview(null)
    setHistoryPreview(null)
    setValidation(null)
    previewRequest.reset()
    settlement.reset()
    history.reset()
  }

  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (!validInstant || !instant) {
      setValidation('Choisis la date et l’heure réelles de l’apparition.')
      return
    }
    if (instant.getTime() > Date.now()) {
      setValidation('L’apparition ne peut pas être dans le futur.')
      return
    }
    if (mode === 'history') {
      if (instant.getTime() > new Date(round.openedAt).getTime()) {
        setValidation('Cette apparition concerne la manche en cours. Choisis « Déclarer et régler la manche ».')
        return
      }
      setValidation(null)
      history.reset()
      setHistoryPreview({ observedAt: instant, tool, idempotencyKey: historyPreview?.idempotencyKey ?? crypto.randomUUID() })
      return
    }
    if (instant.getTime() <= new Date(round.openedAt).getTime()) {
      setValidation(
        'Cette apparition doit être postérieure à l’ouverture de la manche.'
      )
      return
    }

    setValidation(null)
    setPreview(null)
    settlement.reset()
    const version = ++editVersion.current
    const input: SettlementInput = {
      roundId: round.id,
      observedAt: instant,
      tool,
    }
    const revision = roundRevision(round)
    previewRequest.mutate(input, {
      onSuccess(result) {
        if (version === editVersion.current)
          setPreview({ input, result, revision })
      },
    })
  }

  function confirm() {
    if (!canConfirm || !preview || confirmationInFlight.current) return
    confirmationInFlight.current = true
    settlement.mutate(preview.input, {
      onSuccess: onSettled,
      onSettled() {
        confirmationInFlight.current = false
      },
    })
  }

  function confirmHistory() {
    if (!historyPreview || busy || confirmationInFlight.current) return
    confirmationInFlight.current = true
    history.mutate(historyPreview, {
      async onSuccess(result) {
        await onHistoryAdded(result)
        setHistoryPreview(null)
        setObservedAt('')
      },
      onSettled() { confirmationInFlight.current = false },
    })
  }

  return (
    <>
      <fieldset className="admin-mode" disabled={busy}>
        <legend>Que veux-tu enregistrer ?</legend>
        <div className="admin-actions">
          <button className="button" type="button" aria-pressed={mode === 'settle'} onClick={() => { edited(); setMode('settle') }}>
            Déclarer et régler la manche
          </button>
          <button className="button" type="button" aria-pressed={mode === 'history'} onClick={() => { edited(); setMode('history') }}>
            Ajouter à l’historique
          </button>
        </div>
      </fieldset>
      <section className="admin-panel" aria-labelledby="appearance-form-title">
        <div className="section-heading">
          <h2 id="appearance-form-title">{mode === 'history' ? 'Une rencontre à rattraper ?' : '1. Raconte la rencontre.'}</h2>
        </div>
        {mode === 'history' ? (
          <p>Pour une rencontre oubliée ou un deuxième scolo vu avant la réouverture du jeu. Ajoute une apparition survenue au plus tard le {formatInstant(round.openedAt)}. Aucun gain ni bonus ne sera versé.</p>
        ) : (
          <p className="admin-muted">Manche ouverte le {formatInstant(round.openedAt)}.</p>
        )}
        <p>
          {round.predictionCount} pronostic
          {round.predictionCount > 1 ? 's' : ''} en jeu
          {' · '}
          {formatPoints(round.pot)} Zikak engagés.
        </p>
        <form className="admin-form" onSubmit={prepare}>
          <AppearanceDateTimePicker
            value={observedAt}
            onChange={(value) => {
              edited()
              setObservedAt(value)
            }}
            openedAt={mode === 'settle' ? round.openedAt : undefined}
            latestAt={mode === 'history' ? round.openedAt : undefined}
            disabled={busy}
          />
          <div className="admin-field">
            <label htmlFor="appearance-tool">
              Avec quoi tu t’en es occupé ?
            </label>
            <select
              id="appearance-tool"
              value={tool}
              onChange={(event) => {
                const choice = tools.find(
                  (item) => item.value === event.target.value
                )
                if (choice) {
                  edited()
                  setTool(choice.value)
                }
              }}
              disabled={busy}
            >
              {tools.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          {(validation || previewRequest.error) && (
            <p className="error-message" role="alert">
              {validation ?? previewRequest.error?.message}
            </p>
          )}
          <button
            className="button button-primary"
            type="submit"
            disabled={busy || !validInstant}
          >
            {mode === 'history'
              ? 'Vérifier la rencontre'
              : previewRequest.isPending
              ? 'Calcul de l’aperçu…'
              : alreadySettled
                ? 'Mise à jour de la manche…'
                : preview
                  ? 'Recalculer l’aperçu'
                  : 'Voir les gains avant de confirmer'}
          </button>
        </form>
      </section>

      {historyPreview && mode === 'history' && (
        <section className="admin-panel" aria-labelledby="history-preview-title" aria-live="polite">
          <h2 id="history-preview-title">Ajouter cette rencontre au journal ?</h2>
          <p><strong>{formatInstant(historyPreview.observedAt.toISOString())}</strong> · {tools.find((item) => item.value === historyPreview.tool)?.label}.</p>
          <p>La manche en cours, les paris et les soldes restent inchangés. Aucun gain, bonus ou tweet ne sera envoyé.</p>
          {history.error && <p className="error-message" role="alert">{history.error.message} Les informations saisies sont conservées.</p>}
          <div className="admin-actions">
            <button className="button button-primary" type="button" disabled={busy} onClick={confirmHistory}>
              {history.isPending ? 'Enregistrement…' : 'Confirmer l’ajout à l’historique'}
            </button>
            <button className="button" type="button" disabled={busy} onClick={() => { edited(); document.getElementById('appearance-date')?.focus() }}>Modifier les informations</button>
          </div>
        </section>
      )}
      {preview && mode === 'settle' && (
        <section
          className="admin-panel"
          aria-labelledby="settlement-preview-title"
          aria-live="polite"
        >
          <div className="section-heading">
            <h2 id="settlement-preview-title">2. Vérifie la répartition.</h2>
          </div>
          <p>
            Apparition le{' '}
            <strong>{formatInstant(preview.result.observedAt)}</strong>
            {' · '}
            {tools.find((item) => item.value === preview.result.tool)?.label ??
              preview.result.tool}
            .
          </p>
          <SettlementDetails result={preview.result} />
          {roundChanged && (
            <p className="error-message" role="status">
              Les pronostics ont changé depuis cet aperçu. Recalcule-le avant de
              confirmer.
            </p>
          )}
          {settlement.error && (
            <p className="error-message" role="alert">
              {settlement.error.message} Les informations saisies sont
              conservées.
            </p>
          )}
          <p>
            La confirmation enregistre l’apparition, verse les gains, ajoute 2
            Zikak aux joueurs perdants dont le solde reste à zéro et ouvre la
            manche suivante. Les tickets pris à partir de l’heure de
            l’apparition sont remboursés, y compris ceux ajoutés entre cet
            aperçu et ta confirmation.
          </p>
          <div className="admin-actions">
            <button
              className="button button-primary"
              type="button"
              onClick={confirm}
              disabled={!canConfirm}
            >
              {settlement.isPending
                ? 'Règlement en cours…'
                : alreadySettled
                  ? 'Manche réglée'
                  : 'Confirmer l’apparition et les gains'}
            </button>
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => {
                edited()
                document.getElementById('appearance-date')?.focus()
              }}
            >
              Modifier les informations
            </button>
          </div>
        </section>
      )}
    </>
  )
}

function SettlementDetails({ result }: { result: Settlement }) {
  const winners = result.entries.filter((entry) => entry.outcome === 'won')
  const refunds = result.entries.filter((entry) => entry.outcome === 'refunded')
  const losers = result.entries.filter((entry) => entry.outcome === 'lost')

  return (
    <>
      <dl className="admin-totals">
        <div>
          <dt>Cagnotte à répartir</dt>
          <dd>{formatPoints(result.pot)} Zikak</dd>
        </div>
        <div>
          <dt>Mises à rembourser</dt>
          <dd>{formatPoints(result.totalRefunded)} Zikak</dd>
        </div>
      </dl>
      <h3>Les pronostics gagnants</h3>
      {result.winningDistanceMs !== null && (
        <p>
          {result.winningDistanceMs === 0
            ? 'La date exacte a été trouvée.'
            : `Meilleur écart : ${formatDistance(result.winningDistanceMs)}.`}{' '}
          Les versements comprennent la mise.
        </p>
      )}
      {winners.length ? (
        <ul className="admin-ticket-list">
          {winners.map((entry) => (
            <li key={entry.predictionId}>
              <div>
                <strong>{entry.playerName}</strong>
                <time dateTime={entry.predictedAt}>
                  {formatDate(entry.predictedAt, { year: 'numeric' })}
                </time>
                <span className="admin-muted">
                  {formatPoints(entry.stake)} Zikak misés
                </span>
              </div>
              <strong className="admin-payout">
                {formatPoints(entry.payout)} Zikak à recevoir
              </strong>
            </li>
          ))}
        </ul>
      ) : (
        <p>
          Aucun pronostic admissible pour cette apparition. Il n’y a pas de
          gagnant.
        </p>
      )}
      {losers.length > 0 && (
        <p className="admin-muted">
          {losers.length} autre{losers.length > 1 ? 's' : ''} pronostic
          {losers.length > 1 ? 's' : ''} ne gagne{losers.length > 1 ? 'nt' : ''}{' '}
          pas cette manche.
        </p>
      )}
      {(result.replayBonuses ?? []).length > 0 && (
        <>
          <h3>2 Zikak pour rejouer</h3>
          <p>
            Un bonus par joueur perdant dont le solde est à zéro après les gains
            et les remboursements. Ces points ne sont pas pris dans la cagnotte.
          </p>
          <ul className="admin-ticket-list">
            {result.replayBonuses.map((bonus, index) => (
              <li key={index}>
                <strong>{bonus.playerName}</strong>
                <strong className="admin-payout">
                  +{formatPoints(bonus.amount)} Zikak
                </strong>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Les remboursements</h3>
      {refunds.length ? (
        <>
          <p>Ces tickets ont été pris à partir du moment de l’apparition.</p>
          <ul className="admin-ticket-list">
            {refunds.map((entry) => (
              <li key={entry.predictionId}>
                <div>
                  <strong>{entry.playerName}</strong>
                  <time dateTime={entry.predictedAt}>
                    {formatDate(entry.predictedAt, { year: 'numeric' })}
                  </time>
                </div>
                <strong className="admin-payout">
                  {formatPoints(entry.payout)} Zikak rendus
                </strong>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>Aucun ticket à rembourser.</p>
      )}
    </>
  )
}
