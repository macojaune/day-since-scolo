import { gameLabel, gameScore, type ArcadeGame } from '../weapons/catalog'
import { SANDALE_LEADERBOARD_PATH } from '../arcade-links'

export const GAME_SHARE_URL = 'https://scolo.marvinl.com'
export const LEADERBOARD_SHARE_URL = `${GAME_SHARE_URL}${SANDALE_LEADERBOARD_PATH}`
export type ShareEntry = { rank: number; name: string; elapsedMs: number; crushed: number; isMe: boolean; points?: number }
export type ShareBoard = { entries: ShareEntry[]; me: ShareEntry | null }

export function shareDuration(elapsedMs: number) {
  const tenths = Math.floor(elapsedMs / 100)
  const hours = Math.floor(tenths / 36000)
  const minutes = Math.floor(tenths / 600) % 60
  const seconds = (tenths % 600) / 10
  const parts: string[] = []
  if (hours) parts.push(`${hours} heure${hours > 1 ? 's' : ''}`)
  if (minutes) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`)
  if (seconds || !parts.length) parts.push(`${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(seconds)} seconde${seconds > 1 ? 's' : ''}`)
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} et ${parts.at(-1)}` : parts[0]!
}

export function shareMessage(board?: ShareBoard, game: ArcadeGame = 'sandale') {
  if (game !== 'sandale') return board?.me ? `Je suis top ${board.me.rank} avec ${gameScore(game, board.me)} au jeu ${gameLabel(game)} sur BÈT a milpat. Qui fait mieux ?` : `Le classement ${gameLabel(game)} sur BÈT a milpat. Qui fait mieux ?`
  return board?.me
    ? `Je suis top ${board.me.rank} avec ${shareDuration(board.me.elapsedMs)} sur BÈT a milpat 👀 Qui me passe devant ?`
    : 'Le classement de BÈT a milpat 👀 Qui tient le plus longtemps avec la sandale ?'
}
export function shareLinks(board?: ShareBoard, url = GAME_SHARE_URL, game: ArcadeGame = 'sandale') {
  const text = shareMessage(board, game)
  return {
    x: `https://x.com/intent/tweet?${new URLSearchParams({ text, url })}`,
    whatsapp: `https://wa.me/?${new URLSearchParams({ text: `${text}\n${url}` })}`,
    copy: `${text}\n${url}`,
  }
}
