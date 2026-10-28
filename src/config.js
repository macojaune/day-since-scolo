/** @typedef {'local' | 'scolo'} WalletMode */
/** @typedef {{ SCOLO_WALLET_MODE: WalletMode, DATABASE_URL: string, DATABASE_AUTH_TOKEN?: string }} DatabaseConfiguration */
/** @typedef {{ SCOLO_WALLET_MODE: WalletMode, APP_URL: string }} ApplicationConfiguration */
/** @typedef {{ SCOLO_TWEETS_ENABLED?: 'true' | 'false', TWITTER_API_KEY?: string, TWITTER_API_SECRET?: string, TWITTER_ACCESS_TOKEN?: string, TWITTER_ACCESS_SECRET?: string }} TweetConfiguration */

const loopbackNames = new Set(['localhost', '127.0.0.1', '[::1]'])

/** @param {string} hostname */
function isPublicHostname(hostname) {
  return hostname.includes('.') && !loopbackNames.has(hostname) &&
    !hostname.endsWith('.localhost') && !hostname.endsWith('.local') &&
    !hostname.startsWith('[') && !/^\d+(?:\.\d+){3}$/.test(hostname)
}

/** @param {string | undefined | null} host */
export function isLoopbackHost(host) {
  if (!host || /[\s/@\\?#]/.test(host)) return false
  try {
    const url = new URL(`http://${host}`)
    return loopbackNames.has(url.hostname) && url.host === host.toLowerCase()
  } catch { return false }
}

/** @param {DatabaseConfiguration} config */
export function assertDatabaseConfiguration(config) {
  if (config.SCOLO_WALLET_MODE === 'local') {
    const url = config.DATABASE_URL
    if (!url.startsWith('file:') || url.startsWith('file://') ||
      !url.slice(5) || /[?#\u0000-\u001f]/.test(url)) {
      throw new Error('Le mode local exige un chemin SQLite file: local, sans paramètres.')
    }
    return
  }
  if (config.SCOLO_WALLET_MODE !== 'scolo') throw new Error('Mode de portefeuille inconnu.')
  let url
  try { url = new URL(config.DATABASE_URL) } catch { throw new Error('Adresse de base Scolo invalide.') }
  if (!['libsql:', 'https:'].includes(url.protocol) || !isPublicHostname(url.hostname) ||
    url.username || url.password || !['', '/'].includes(url.pathname) || url.search || url.hash) {
    throw new Error('Le mode Scolo exige une adresse Turso libsql: ou https: publique, sans identifiants ni paramètres.')
  }
  if (!config.DATABASE_AUTH_TOKEN?.trim()) throw new Error('DATABASE_AUTH_TOKEN est requis pour la base Scolo.')
}

/** @param {ApplicationConfiguration} config */
export function applicationOrigin(config) {
  let url
  try { url = new URL(config.APP_URL) } catch { throw new Error('APP_URL invalide.') }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('APP_URL doit contenir uniquement l’origine de l’application.')
  }
  if (config.SCOLO_WALLET_MODE === 'local') {
    if (!['http:', 'https:'].includes(url.protocol) || !loopbackNames.has(url.hostname)) {
      throw new Error('Le mode local exige une origine localhost.')
    }
  } else if (config.SCOLO_WALLET_MODE !== 'scolo' || url.protocol !== 'https:' || !isPublicHostname(url.hostname)) {
    throw new Error('Le mode Scolo exige une origine publique HTTPS.')
  }
  return url.origin
}

/** @param {DatabaseConfiguration & ApplicationConfiguration & TweetConfiguration & { CLERK_SECRET_KEY: string, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: string }} config */
export function assertDeploymentConfiguration(config) {
  assertDatabaseConfiguration(config)
  applicationOrigin(config)
  const kind = config.SCOLO_WALLET_MODE === 'local' ? 'test' : 'live'
  if (!config.CLERK_SECRET_KEY.startsWith(`sk_${kind}_`) ||
    !config.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.startsWith(`pk_${kind}_`)) {
    throw new Error(`Le mode ${config.SCOLO_WALLET_MODE} exige les clés Clerk ${kind === 'test' ? 'Development' : 'Production'} correspondantes.`)
  }
  if (config.SCOLO_TWEETS_ENABLED === 'true' && (config.SCOLO_WALLET_MODE !== 'scolo' ||
    ![config.TWITTER_API_KEY, config.TWITTER_API_SECRET, config.TWITTER_ACCESS_TOKEN, config.TWITTER_ACCESS_SECRET].every(value => value?.trim()))) {
    throw new Error('La publication X exige le mode Scolo et ses quatre identifiants de publication serveur.')
  }
}

/** @param {string | undefined | null} host @param {ApplicationConfiguration} config */
export function isAllowedApplicationHost(host, config) {
  if (!host || /[\s/@\\?#]/.test(host)) return false
  try {
    const expected = new URL(applicationOrigin(config))
    return config.SCOLO_WALLET_MODE === 'local' ? isLoopbackHost(host) : host === expected.host
  } catch { return false }
}

/** @param {{ host?: string | null, origin?: string | null, fetchSite?: string | string[] | null }} request @param {ApplicationConfiguration} config */
export function isSameOriginMutation(request, config) {
  try {
    const expected = new URL(applicationOrigin(config))
    return request.host === expected.host && request.origin === expected.origin &&
      !Array.isArray(request.fetchSite) && request.fetchSite !== 'cross-site'
  } catch { return false }
}

/** @param {string | null} userId @param {string} adminUserIds */
export function isConfiguredAdmin(userId, adminUserIds) {
  return Boolean(userId) && adminUserIds.split(',').map(id => id.trim()).filter(Boolean).includes(userId ?? '')
}
