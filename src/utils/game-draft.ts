import { localInput } from './game-format'

export type PredictionDraft = { day: string; stake: string }

export function isCalendarDay(value: string): boolean {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00-04:00`)
  return (
    Number.isFinite(date.getTime()) && localInput(date).slice(0, 10) === value
  )
}

function parseDraft(raw: string | null): PredictionDraft | null {
  const saved: unknown = JSON.parse(raw ?? 'null')
  if (!saved || typeof saved !== 'object') return null
  return {
    day:
      'day' in saved &&
      typeof saved.day === 'string' &&
      isCalendarDay(saved.day)
        ? saved.day
        : '',
    stake:
      'stake' in saved &&
      typeof saved.stake === 'string' &&
      Number.isSafeInteger(Number(saved.stake)) &&
      Number(saved.stake) > 0
        ? saved.stake
        : '1',
  }
}

// Carry the visitor's current choices into exactly one sign-in, even when
// the destination account already has an older draft in this tab.
export function rememberDraftForSignIn(roundId: string) {
  try {
    const draft = parseDraft(
      sessionStorage.getItem(`scolo-board-draft:visitor:${roundId}`)
    )
    if (draft)
      sessionStorage.setItem(
        `scolo-board-transfer:${roundId}`,
        JSON.stringify({ draft, createdAt: Date.now() })
      )
  } catch {
    /* Browser storage is optional. */
  }
}

export function restorePredictionDraft(
  roundId: string,
  userId: string | null
): PredictionDraft | null {
  if (userId) {
    const transferKey = `scolo-board-transfer:${roundId}`
    try {
      const transfer: unknown = JSON.parse(
        sessionStorage.getItem(transferKey) ?? 'null'
      )
      sessionStorage.removeItem(transferKey)
      if (
        transfer &&
        typeof transfer === 'object' &&
        'createdAt' in transfer &&
        typeof transfer.createdAt === 'number' &&
        'draft' in transfer
      ) {
        const age = Date.now() - transfer.createdAt
        if (age >= 0 && age < 30 * 60 * 1000)
          return parseDraft(JSON.stringify(transfer.draft))
      }
    } catch {
      /* A damaged transfer does not discard the account's own draft. */
    }
  }
  try {
    return parseDraft(
      sessionStorage.getItem(
        `scolo-board-draft:${userId ?? 'visitor'}:${roundId}`
      )
    )
  } catch {
    return null
  }
}
