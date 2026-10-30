import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GAME_SHARE_URL, shareDuration, shareLinks, shareMessage } from '../src/game/sandale/sharing'
import { renderArcadeStory } from '../src/server/arcade/story-image'

const board = { entries: [
  { rank: 1, name: 'Alice · test', elapsedMs: 18200, crushed: 31, isMe: false },
  { rank: 2, name: 'Bob · test', elapsedMs: 15600, crushed: 28, isMe: true },
  { rank: 3, name: 'Chloé · test', elapsedMs: 12100, crushed: 21, isMe: false },
], me: { rank: 2, name: 'Bob · test', elapsedMs: 15600, crushed: 28, isMe: true } }

test('prepared social messages use the real rank and production URL, without inventing a guest rank', () => {
  const links = shareLinks(board)
  assert.equal(new URL(links.x).searchParams.get('url'), GAME_SHARE_URL)
  assert.equal(new URL(links.x).searchParams.get('text'), shareMessage(board))
  assert.match(new URL(links.whatsapp).searchParams.get('text')!, /Je suis top 2 avec 15,6 secondes/s)
  assert.match(links.copy, /https:\/\/scolo\.marvinl\.com/)
  for (const rank of [1, 2, 40, 52]) {
    const ranked = shareLinks({ ...board, me: { ...board.me, rank } })
    for (const message of [new URL(ranked.x).searchParams.get('text')!, new URL(ranked.whatsapp).searchParams.get('text')!, ranked.copy]) {
      assert.ok(message.startsWith(`Je suis top ${rank} avec `))
      assert.doesNotMatch(message, /#/)
    }
  }
  assert.doesNotMatch(shareMessage(), /top \d|#|localhost/)
})

test('shared durations name their units for short games, minutes and hours', () => {
  for (const [ms, expected] of [[10500, '10,5 secondes'], [72000, '1 minute et 12 secondes'], [60000, '1 minute'], [1000, '1 seconde'], [0, '0 seconde'], [3723400, '1 heure, 2 minutes et 3,4 secondes']] as const) assert.equal(shareDuration(ms), expected)
})

test('story export is a valid 1080 by 1920 PNG with and without a personal result', async () => {
  for (const data of [board, { entries: [], me: null }]) {
    const bytes = await renderArcadeStory(data)
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.equal(bytes.readUInt32BE(16), 1080)
    assert.equal(bytes.readUInt32BE(20), 1920)
    assert.ok(bytes.length > 20000)
  }
})
