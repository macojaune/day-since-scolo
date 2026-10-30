export const GAME_SHARE_URL = 'https://scolo.marvinl.com'
export type ShareEntry = { rank: number; name: string; elapsedMs: number; crushed: number; isMe: boolean }
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

export function shareMessage(board?: ShareBoard) {
  return board?.me
    ? `Je suis top ${board.me.rank} avec ${shareDuration(board.me.elapsedMs)} sur BÈT a milpat 👀 Qui me passe devant ?`
    : 'Le classement de BÈT a milpat 👀 Qui tient le plus longtemps avec la sandale ?'
}
export function shareLinks(board?: ShareBoard) {
  const text = shareMessage(board)
  return {
    x: `https://x.com/intent/tweet?${new URLSearchParams({ text, url: GAME_SHARE_URL })}`,
    whatsapp: `https://wa.me/?${new URLSearchParams({ text: `${text}\n${GAME_SHARE_URL}` })}`,
    copy: `${text}\n${GAME_SHARE_URL}`,
  }
}
