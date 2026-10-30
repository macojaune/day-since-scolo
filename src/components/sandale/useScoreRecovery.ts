import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@clerk/nextjs'
import { acknowledgeScore, markScoreDurable, pendingScores, SCORE_QUEUE_EVENT } from '~/game/sandale/pending-scores'
import type { ScoreReceipt } from '~/game/sandale/protocol'
import { api } from '~/utils/api'

function recoveryError(cause: unknown) {
  if (cause instanceof Error && 'data' in cause && cause.data) return cause.message
  return 'La sauvegarde n’a pas abouti. Ta partie reste en attente ; réessaie.'
}

export function useScoreRecovery() {
  const { isLoaded, isSignedIn, userId } = useAuth()
  const viewerId = userId ?? null
  const utils = api.useUtils()
  const pending = api.arcade.pending.useQuery({ viewerId }, { enabled: isLoaded })
  const { mutateAsync: finish } = api.arcade.finish.useMutation()
  const { mutateAsync: restore } = api.arcade.restore.useMutation()
  const { mutateAsync: claim } = api.arcade.claim.useMutation()
  const [busy, setBusy] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<(ScoreReceipt & { viewerId: string }) | null>(null)
  const [bonus, setBonus] = useState<{ key: string; amount: number; total: number; viewerId: string } | null>(null)
  const draining = useRef(false)
  const loadedFor = useRef<string | null | undefined>(undefined)
  const attemptedClaims = useRef(new Set<string>())

  const drain = useCallback(async () => {
    if (draining.current) return
    draining.current = true
    setBusy(true)
    setError(null)
    try {
      const attempted = new Set<string>()
      // New completed games can join while a previous receipt is being written.
      for (;;) {
        const item = pendingScores().find(score => !attempted.has(score.token))
        if (!item) break
        attempted.add(item.token)
        const result = item.submission ? await finish(item.submission) : await restore({ token: item.token })
        if (result?.claimed && viewerId) { acknowledgeScore(result.id); setSaved({ ...result, viewerId }) }
        else if (result) markScoreDurable(item.token, result.id)
        else if (item.id) acknowledgeScore(item.id)
      }
      await Promise.all([utils.arcade.pending.invalidate(), utils.arcade.standings.invalidate()])
    } catch (cause) { setError(recoveryError(cause)) }
    finally { draining.current = false; setBusy(false) }
  }, [finish, restore, utils, viewerId])

  useEffect(() => {
    if (loadedFor.current !== viewerId) { loadedFor.current = viewerId; void drain() }
    const recover = () => { void drain() }
    window.addEventListener(SCORE_QUEUE_EVENT, recover)
    window.addEventListener('online', recover)
    return () => {
      window.removeEventListener(SCORE_QUEUE_EVENT, recover)
      window.removeEventListener('online', recover)
    }
  }, [drain, viewerId])

  const claimScore = useCallback(async () => {
    if (!userId || !pending.data || pending.data.otherAccount) return
    setClaiming(true)
    setError(null)
    try {
      const result = await claim({ viewerId: userId })
      if (result.reward.credited > 0) setBonus({ key: `${userId}:${result.reward.total}`, amount: result.reward.credited, total: result.reward.total, viewerId: userId })
      acknowledgeScore(result.id)
      setSaved({ ...result, viewerId: userId })
      await Promise.all([utils.arcade.pending.invalidate(), utils.arcade.leaderboard.invalidate(), utils.arcade.standings.invalidate(), utils.app.me.invalidate()])
    } catch (cause) { setError(recoveryError(cause)) }
    finally { setClaiming(false) }
  }, [claim, pending.data, userId, utils])

  useEffect(() => {
    if (!isSignedIn || !userId || !pending.data || pending.data.claimed || pending.data.otherAccount || busy) return
    const key = `${userId}:${pending.data.id}`
    if (attemptedClaims.current.has(key)) return
    attemptedClaims.current.add(key)
    void claimScore()
  }, [isSignedIn, userId, pending.data, busy, claimScore])

  return { isLoaded, isSignedIn, viewerId, busy, claiming, pending, error,
    saved: saved?.viewerId === userId ? saved : null, bonus: bonus?.viewerId === userId ? bonus : null,
    retry: () => pending.data && userId ? claimScore() : drain() }
}
