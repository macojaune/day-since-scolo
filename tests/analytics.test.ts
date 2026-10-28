import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type * as analyticsModule from '../src/utils/analytics'
import {
  ANALYTICS_HOST,
  ANALYTICS_WEBSITE_ID,
  analyticsErrorReason,
  betAnalyticsData,
  isAnalyticsPage,
  sanitizeAnalyticsPayload,
} from '../src/utils/analytics'

type Payload = Record<string, unknown>
type Analytics = typeof analyticsModule
let moduleSequence = 0

async function freshAnalytics(): Promise<Analytics> {
  // A new module models a page reload, while a reused sessionStorage models the same tab.
  return import(new URL(`../src/utils/analytics.ts?test=${++moduleSequence}`, import.meta.url).href) as Promise<Analytics>
}

function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

function browser(t: TestContext, options: {
  url?: string
  session?: ReturnType<typeof storage>
  local?: ReturnType<typeof storage>
  track?: (payload: Payload) => void | Promise<unknown>
} = {}) {
  const state = {
    location: new URL(options.url ?? `https://${ANALYTICS_HOST}/?email=private@example.com#private-token`),
    sessionStorage: options.session ?? storage(),
    localStorage: options.local ?? storage(),
    umami: options.track ? { track: options.track } : undefined as { track: (payload: Payload) => void | Promise<unknown> } | undefined,
  }
  const replacements: Record<string, unknown> = {
    window: state,
    document: { referrer: 'https://source.example/profile/private-person?token=private-token' },
    navigator: { language: 'fr-FR' },
    screen: { width: 1440, height: 900 },
    fetch: () => { throw new Error('Analytics tests must never use the network') },
  }
  for (const [key, value] of Object.entries(replacements)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, value })
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous)
      else Reflect.deleteProperty(globalThis, key)
    })
  }
  return state
}

function basePayload(overrides: Payload = {}): Payload {
  return {
    website: ANALYTICS_WEBSITE_ID,
    hostname: ANALYTICS_HOST,
    url: `https://${ANALYTICS_HOST}/`,
    language: 'fr-FR',
    screen: '1440x900',
    ...overrides,
  }
}

test('analytics removes identities, auth parameters, arbitrary errors and referrer paths', () => {
  const result = sanitizeAnalyticsPayload('event', basePayload({
    name: 'bet_confirmed',
    url: `https://${ANALYTICS_HOST}/?email=private@example.com&__clerk_ticket=private-token#private-hash`,
    referrer: 'https://source.example/private-profile?email=private@example.com#private-hash',
    title: 'Private Person is signed in',
    id: 'user_private_clerk',
    email: 'private@example.com',
    tag: 'private-tag',
    data: { stake: 2, days_ahead: 4, email: 'private@example.com', userId: 'user_private_clerk', reason: 'Private Person rejected', error: 'private-token' },
  }))
  assert.deepEqual(result, {
    website: ANALYTICS_WEBSITE_ID, hostname: ANALYTICS_HOST,
    url: '/', title: 'Scolo · Jou san bèt a mil pat',
    referrer: 'https://source.example', language: 'fr-FR', screen: '1440x900',
    name: 'bet_confirmed', data: { stake: 2, days_ahead: 4 },
  })
  assert.doesNotMatch(JSON.stringify(result), /private|user_|clerk|@/i)
})

test('only public pages on the exact production domain can send analytics', () => {
  assert.equal(isAnalyticsPage(ANALYTICS_HOST, '/'), true)
  assert.equal(isAnalyticsPage(ANALYTICS_HOST, '/confidentialite'), true)
  for (const pathname of ['/admin', '/sign-in', '/sign-in/sso-callback', '/sign-up', '/explorations', '/api/trpc/app.bet']) {
    assert.equal(isAnalyticsPage(ANALYTICS_HOST, pathname), false)
    assert.equal(sanitizeAnalyticsPayload('event', basePayload({ url: pathname })), false)
  }
  for (const hostname of ['localhost', '127.0.0.1', 'dev.scolo.marvinl.com', 'scolo.marvinl.com.example']) {
    assert.equal(isAnalyticsPage(hostname, '/'), false)
    assert.equal(sanitizeAnalyticsPayload('event', basePayload({ hostname })), false)
    assert.equal(sanitizeAnalyticsPayload('event', basePayload({ url: `https://${hostname}/` })), false)
  }
  assert.equal(sanitizeAnalyticsPayload('identify', basePayload()), false)
  assert.equal(sanitizeAnalyticsPayload('event', basePayload({ website: 'another-project' })), false)
  assert.equal(sanitizeAnalyticsPayload('event', basePayload({ name: 'private@example.com' })), false)
})

test('pageviews have no event data and malformed event properties are discarded', () => {
  const pageview = sanitizeAnalyticsPayload('event', basePayload({ url: '/confidentialite?private=yes', data: { email: 'private@example.com' } }))
  assert.ok(pageview)
  assert.equal(pageview.url, '/confidentialite')
  assert.equal(pageview.title, 'Confidentialité · Scolo')
  assert.equal(pageview.data, undefined)
  const event = sanitizeAnalyticsPayload('event', basePayload({ name: 'bet_rejected', data: {
    stake: Infinity, days_ahead: -1, committed: 1.5, tickets: Number.MAX_SAFE_INTEGER + 1,
    source: 'private@example.com', reason: 'signed_out',
  } }))
  assert.ok(event)
  assert.deepEqual(event.data, { reason: 'signed_out' })
})

test('bet lead time uses Guadeloupe civil days across UTC midnight and local midnight', () => {
  const target = new Date('2026-10-29T04:00:00.000Z')
  assert.deepEqual(betAnalyticsData(target, 2, new Date('2026-10-28T03:59:59.999Z')), { stake: 2, days_ahead: 2 })
  assert.deepEqual(betAnalyticsData(target, 2, new Date('2026-10-28T04:00:00.000Z')), { stake: 2, days_ahead: 1 })
  assert.deepEqual(betAnalyticsData(target, 2, new Date('2026-10-29T00:01:00.000Z')), { stake: 2, days_ahead: 1 })
  assert.deepEqual(betAnalyticsData(target, 2, new Date('2026-10-29T04:00:00.000Z')), { stake: 2, days_ahead: 0 })
  assert.deepEqual(betAnalyticsData(new Date(NaN), NaN), {})
})

test('error classification never forwards raw server messages', () => {
  assert.equal(analyticsErrorReason('UNAUTHORIZED'), 'signed_out')
  assert.equal(analyticsErrorReason('BAD_REQUEST'), 'invalid_bet')
  assert.equal(analyticsErrorReason('INTERNAL_SERVER_ERROR'), 'server_error')
  assert.equal(analyticsErrorReason('Email private@example.com already exists'), 'unavailable')
  assert.equal(analyticsErrorReason(), 'unavailable')
})

test('events wait for the tracker and flush once without exposing the deduplication key', async t => {
  const calls: Payload[] = []
  const state = browser(t)
  const analytics = await freshAnalytics()
  analytics.trackGameEvent('bet_confirmed', { stake: 2, days_ahead: 3 }, 'private-prediction-id')
  analytics.trackGameEvent('bet_confirmed', { stake: 2, days_ahead: 3 }, 'private-prediction-id')
  assert.equal(calls.length, 0)
  state.umami = { track: payload => { calls.push(payload) } }
  analytics.flushAnalyticsEvents()
  analytics.flushAnalyticsEvents()
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.name, 'bet_confirmed')
  assert.deepEqual(calls[0]?.data, { stake: 2, days_ahead: 3 })
  assert.doesNotMatch(JSON.stringify(calls), /private|@|token/)
})

test('confirmed bets and exhausted wallets remain deduplicated after a page reload in the same tab', async t => {
  const calls: Payload[] = []
  browser(t, { track: payload => { calls.push(payload) } })
  const first = await freshAnalytics()
  first.trackGameEvent('bet_confirmed', { stake: 3 }, 'ticket-one')
  first.trackGameEvent('wallet_empty', { committed: 3, tickets: 1 }, 'player-one:round-one')
  const reloaded = await freshAnalytics()
  assert.notEqual(reloaded.trackGameEvent, first.trackGameEvent)
  reloaded.trackGameEvent('bet_confirmed', { stake: 3 }, 'ticket-one')
  reloaded.trackGameEvent('wallet_empty', { committed: 3, tickets: 1 }, 'player-one:round-one')
  assert.deepEqual(calls.map(call => call.name), ['bet_confirmed', 'wallet_empty'])
  reloaded.trackGameEvent('bet_confirmed', { stake: 1 }, 'ticket-two')
  reloaded.trackGameEvent('wallet_empty', { committed: 1, tickets: 1 }, 'player-one:round-two')
  assert.equal(calls.length, 4)
})

test('development hosts, private routes and the Umami opt-out suppress events before queuing', async t => {
  const calls: Payload[] = []
  const state = browser(t, { track: payload => { calls.push(payload) } })
  const analytics = await freshAnalytics()
  for (const url of ['http://localhost:3092/', `https://${ANALYTICS_HOST}/admin`, `https://${ANALYTICS_HOST}/sign-in`]) {
    state.location = new URL(url)
    analytics.trackGameEvent('bet_submitted', { stake: 1 })
    analytics.flushAnalyticsEvents()
  }
  state.location = new URL(`https://${ANALYTICS_HOST}/`)
  state.localStorage.setItem('umami.disabled', '1')
  analytics.trackGameEvent('bet_submitted', { stake: 1 })
  analytics.flushAnalyticsEvents()
  assert.equal(calls.length, 0)
})

test('tracker and optional storage failures do not throw into the game', async t => {
  const state = browser(t, { track: () => { throw new Error('blocked tracker') } })
  const analytics = await freshAnalytics()
  assert.doesNotThrow(() => analytics.trackGameEvent('bet_submitted', { stake: 1 }))
  state.umami = { track: () => Promise.reject(new Error('rejected tracker')) }
  assert.doesNotThrow(() => analytics.trackGameEvent('bet_confirmed', { stake: 1 }, 'failure-ticket'))
  // Give the rejection handler a turn; node:test fails if a rejection escapes.
  await new Promise(resolve => setImmediate(resolve))
  state.sessionStorage.getItem = () => { throw new Error('storage blocked') }
  state.sessionStorage.setItem = () => { throw new Error('storage blocked') }
  let calls = 0
  state.umami = { track: () => { calls++ } }
  analytics.trackGameEvent('wallet_empty', {}, 'memory-only')
  analytics.trackGameEvent('wallet_empty', {}, 'memory-only')
  assert.equal(calls, 1)
  state.localStorage.getItem = () => { throw new Error('storage blocked') }
  assert.doesNotThrow(() => analytics.trackGameEvent('bet_submitted', { stake: 1 }))
  assert.equal(calls, 1)
})
