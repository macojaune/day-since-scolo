export const ANALYTICS_HOST = 'scolo.marvinl.com'
export const ANALYTICS_WEBSITE_ID = 'e5e9b232-675e-4172-b463-32c56e9dc567'
export const ANALYTICS_SCRIPT = 'https://analytics.marvinl.com/script.js'

const events = ['bet_date_selected', 'bet_stake_changed', 'game_sign_in_requested',
  'game_joined', 'bet_submitted', 'bet_confirmed', 'bet_rejected', 'bet_failed', 'wallet_empty'] as const
type GameEvent = typeof events[number]
type EventData = { stake?: number; days_ahead?: number; source?: 'header' | 'bet' | 'calendar' | 'ticket'; reason?: string; committed?: number; tickets?: number }
type Payload = Record<string, unknown>
type QueuedEvent = { name: GameEvent; data: EventData }
const pending: QueuedEvent[] = []
const recorded = new Set<string>()
const storageKey = 'scolo-analytics-once'

declare global {
  interface Window {
    umami?: { track: (payload: Payload) => Promise<unknown> | void }
    scoloBeforeAnalytics?: typeof sanitizeAnalyticsPayload
  }
}

export function isAnalyticsPage(hostname: string, pathname: string) {
  return hostname === ANALYTICS_HOST && (pathname === '/' || pathname === '/confidentialite')
}

export function analyticsErrorReason(code?: string) {
  switch (code) {
    case 'BAD_REQUEST': return 'invalid_bet'
    case 'UNAUTHORIZED': return 'signed_out'
    case 'FORBIDDEN': return 'forbidden'
    case 'TOO_MANY_REQUESTS': return 'rate_limited'
    case 'INTERNAL_SERVER_ERROR': return 'server_error'
    default: return 'unavailable'
  }
}

function cleanData(data: Payload): EventData {
  const clean: EventData = {}
  for (const key of ['stake', 'days_ahead', 'committed', 'tickets'] as const) {
    const value = data[key]
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) clean[key] = value
  }
  if (['header', 'bet', 'calendar', 'ticket'].includes(String(data.source))) clean.source = data.source as EventData['source']
  if (['invalid_bet', 'signed_out', 'forbidden', 'rate_limited', 'server_error', 'unavailable'].includes(String(data.reason))) clean.reason = data.reason as string
  return clean
}

/** No identities, raw errors, query strings, auth routes or arbitrary properties. */
export function sanitizeAnalyticsPayload(type: string, payload: Payload): Payload | false {
  if (type !== 'event' || payload.website !== ANALYTICS_WEBSITE_ID || payload.hostname !== ANALYTICS_HOST) return false
  try {
    const url = new URL(String(payload.url), `https://${ANALYTICS_HOST}`)
    if (!isAnalyticsPage(url.hostname, url.pathname)) return false
    if (payload.name !== undefined && !events.includes(payload.name as GameEvent)) return false
    let referrer = ''
    try {
      const from = new URL(String(payload.referrer))
      if (from.protocol === 'https:' || from.protocol === 'http:') referrer = from.origin
    } catch { /* Empty or invalid referrer. */ }
    return {
      website: ANALYTICS_WEBSITE_ID,
      hostname: ANALYTICS_HOST,
      url: url.pathname,
      title: url.pathname === '/' ? 'Scolo · Jou san bèt a mil pat' : 'Confidentialité · Scolo',
      referrer,
      ...(typeof payload.language === 'string' ? { language: payload.language } : {}),
      ...(typeof payload.screen === 'string' ? { screen: payload.screen } : {}),
      ...(payload.name ? { name: payload.name, data: cleanData((payload.data ?? {}) as Payload) } : {}),
    }
  } catch { return false }
}

export function betAnalyticsData(predictedAt: Date, stake: number, now = new Date()): EventData {
  // Civil days in Guadeloupe (UTC-4), independent of the player's timezone.
  const day = (value: Date) => Math.floor((value.getTime() - 4 * 3600000) / 86400000)
  return cleanData({ stake, days_ahead: day(predictedAt) - day(now) })
}

function canTrack() {
  if (typeof window === 'undefined' || !isAnalyticsPage(window.location.hostname, window.location.pathname)) return false
  try { return !window.localStorage.getItem('umami.disabled') } catch { return false }
}

function send(event: QueuedEvent) {
  try {
    // Construct the payload ourselves: the tracker may still hold an auth URL after navigation.
    const payload = sanitizeAnalyticsPayload('event', {
      website: ANALYTICS_WEBSITE_ID, hostname: window.location.hostname,
      url: window.location.href, referrer: document.referrer,
      language: navigator.language, screen: `${screen.width}x${screen.height}`,
      ...event,
    })
    if (payload) void Promise.resolve(window.umami?.track(payload)).catch(() => undefined)
  } catch { /* Analytics must never block a bet or surface an error in the game. */ }
}

/** onceKey stays in this tab; it is never part of an analytics payload. */
export function trackGameEvent(name: GameEvent, data: EventData = {}, onceKey?: string) {
  if (!canTrack()) return
  if (onceKey) {
    const key = `${name}:${onceKey}`
    try {
      const stored: unknown = JSON.parse(window.sessionStorage.getItem(storageKey) ?? '[]')
      if (Array.isArray(stored)) for (const value of stored) if (typeof value === 'string') recorded.add(value)
    } catch { /* Fall back to deduplication in memory. */ }
    if (recorded.has(key)) return
    recorded.add(key)
    try { window.sessionStorage.setItem(storageKey, JSON.stringify([...recorded].slice(-300))) } catch { /* Optional storage. */ }
  }
  const event = { name, data: cleanData(data) }
  if (window.umami) send(event)
  else if (pending.length < 100) pending.push(event)
}

export function flushAnalyticsEvents() {
  const queued = pending.splice(0)
  if (canTrack()) for (const event of queued) send(event)
}
