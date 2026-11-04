import assert from 'node:assert/strict'
import { test } from 'node:test'
import { leaderboardGame, SANDALE_LEADERBOARD_PATH } from '../src/game/arcade-links'

test('leaderboard URLs identify a game, not a page or an unimplemented weapon', () => {
  assert.equal(SANDALE_LEADERBOARD_PATH, '/?classement=1')
  assert.equal(leaderboardGame('1'), 'sandale')
  for (const value of [undefined, '', '0', '2', '3', '01', 'sandale', ['1'], ['1', '2']]) {
    assert.equal(leaderboardGame(value), null)
  }
})
