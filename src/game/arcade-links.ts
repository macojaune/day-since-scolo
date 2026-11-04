// Stable game identifiers, independent from the current weapon and leaderboard pages.
export const SANDALE_LEADERBOARD_ID = '1'
export const SANDALE_LEADERBOARD_PATH = `/?classement=${SANDALE_LEADERBOARD_ID}`

export function leaderboardGame(value: unknown): 'sandale' | null {
  return value === SANDALE_LEADERBOARD_ID ? 'sandale' : null
}
