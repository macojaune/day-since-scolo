export const GAME_TIMEZONE = 'America/Guadeloupe'
const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })
export const formatPoints = (value: number) => numberFormat.format(value)
export const formatDate = (value: string | Date, options: Intl.DateTimeFormatOptions = {}) => new Intl.DateTimeFormat('fr-FR', { timeZone: GAME_TIMEZONE, day: 'numeric', month: 'long', ...options }).format(new Date(value))
export const formatTime = (value: string | Date) => formatDate(value, { day: undefined, month: undefined, hour: '2-digit', minute: '2-digit' })
export const formatInstant = (value: string | Date) => formatDate(value, { year: 'numeric', hour: '2-digit', minute: '2-digit' })
export function localInput(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: GAME_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(value)
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`
}
export function fromLocalInput(value: string) {
  // Guadeloupe has no daylight-saving change: a local minute always has UTC-04:00.
  return new Date(`${value}:00-04:00`)
}
export function formatDistance(ms: number) {
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return `${Math.floor(ms / 1000)} s`
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor(minutes % 1440 / 60)
  return [days ? `${days} j` : '', hours ? `${hours} h` : '', minutes % 60 ? `${minutes % 60} min` : ''].filter(Boolean).join(' ') || '0 min'
}
