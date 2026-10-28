import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import {
  isCalendarDay,
  rememberDraftForSignIn,
  restorePredictionDraft,
} from '../src/utils/game-draft'

const values = new Map<string, string>()
beforeEach(() => {
  values.clear()
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  })
})

test('saved calendar dates reject impossible days and handle leap years', () => {
  assert.equal(isCalendarDay('2026-99-99'), false)
  assert.equal(isCalendarDay('2026-02-30'), false)
  assert.equal(isCalendarDay('2026-02-29'), false)
  assert.equal(isCalendarDay('2028-02-29'), true)
  values.set(
    'scolo-board-draft:visitor:round',
    JSON.stringify({ day: '2026-99-99', hour: '27:65', stake: '-3' })
  )
  assert.deepEqual(restorePredictionDraft('round', null), {
    day: '',
    stake: '1',
  })
})

test('the visitor choice explicitly carried through sign-in overrides an old account draft only once', () => {
  const old = { day: '2026-11-01', stake: '1' }
  const current = { day: '2026-11-04', stake: '3' }
  values.set('scolo-board-draft:player:round', JSON.stringify(old))
  values.set('scolo-board-draft:visitor:round', JSON.stringify(current))
  rememberDraftForSignIn('round')
  assert.deepEqual(restorePredictionDraft('round', 'player'), current)
  assert.deepEqual(restorePredictionDraft('round', 'player'), old)
})

test('account and round drafts stay separate and expired transfers are ignored', () => {
  const own = { day: '2026-11-01', stake: '2' }
  values.set('scolo-board-draft:player:round', JSON.stringify(own))
  values.set(
    'scolo-board-transfer:round',
    JSON.stringify({
      createdAt: Date.now() - 31 * 60 * 1000,
      draft: { ...own, stake: '3' },
    })
  )
  assert.deepEqual(restorePredictionDraft('round', 'player'), own)
  assert.equal(restorePredictionDraft('round', 'someone-else'), null)
  assert.equal(restorePredictionDraft('another-round', 'player'), null)
})

test('unavailable browser storage does not block the game', () => {
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    get() {
      throw new Error('disabled')
    },
  })
  assert.doesNotThrow(() => rememberDraftForSignIn('round'))
  assert.equal(restorePredictionDraft('round', 'player'), null)
})
