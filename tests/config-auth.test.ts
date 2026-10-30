import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import {
  assertDatabaseConfiguration, assertDeploymentConfiguration, applicationOrigin,
  isAllowedApplicationHost, isLoopbackHost, isSameOriginMutation, isConfiguredAdmin,
  type ApplicationConfiguration,
} from '../src/config.js'
import { createLocalDatabaseClient } from '../src/server/db/index'

const local = {
  SCOLO_WALLET_MODE: 'local' as const,
  APP_URL: 'http://localhost:3092',
  DATABASE_URL: 'file:./.local/scolo.db',
  CLERK_SECRET_KEY: 'sk_test_test-only',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_test-only',
}
const publicConfig = {
  SCOLO_WALLET_MODE: 'scolo' as const,
  APP_URL: 'https://scolo.example.com',
  DATABASE_URL: 'libsql://scolo.example.turso.io',
  DATABASE_AUTH_TOKEN: 'test-only-not-a-real-token',
  CLERK_SECRET_KEY: 'sk_live_test-only',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_test-only',
}

test('DEV is a hosted service with Clerk Development and its own storage', () => {
  const dev = { ...local, SCOLO_ENVIRONMENT: 'dev' as const, APP_URL: 'https://scolo-dev.example.com', DATABASE_URL: 'file:/data/scolo-dev.db' }
  assert.doesNotThrow(() => assertDeploymentConfiguration(dev))
  assert.equal(applicationOrigin(dev), 'https://scolo-dev.example.com')
  assert.equal(isAllowedApplicationHost('scolo-dev.example.com', dev), true)
  assert.equal(isAllowedApplicationHost('localhost:3092', dev), false)
  assert.throws(() => assertDeploymentConfiguration({ ...dev, CLERK_SECRET_KEY: 'sk_live_test-only' }))
  assert.throws(() => assertDeploymentConfiguration({ ...dev, SCOLO_TWEETS_ENABLED: 'true' }))
  assert.throws(() => assertDeploymentConfiguration({ ...dev, APP_URL: local.APP_URL }))
  assert.throws(() => assertDeploymentConfiguration({ ...dev, SCOLO_ENVIRONMENT: 'prod' }))
})

test('local and public Scolo configurations stay isolated, including Clerk key kind', () => {
  assert.doesNotThrow(() => assertDeploymentConfiguration(local))
  assert.doesNotThrow(() => assertDeploymentConfiguration(publicConfig))
  assert.doesNotThrow(() => assertDeploymentConfiguration({ ...publicConfig, DATABASE_URL: 'https://scolo.example.turso.io/' }))
  for (const config of [
    { ...local, DATABASE_URL: publicConfig.DATABASE_URL },
    { ...local, APP_URL: publicConfig.APP_URL },
    { ...local, CLERK_SECRET_KEY: publicConfig.CLERK_SECRET_KEY },
    { ...local, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: publicConfig.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY },
    { ...publicConfig, DATABASE_URL: local.DATABASE_URL },
    { ...publicConfig, APP_URL: local.APP_URL },
    { ...publicConfig, CLERK_SECRET_KEY: local.CLERK_SECRET_KEY },
    { ...publicConfig, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: local.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY },
    { ...publicConfig, DATABASE_AUTH_TOKEN: '' },
    { ...publicConfig, DATABASE_AUTH_TOKEN: undefined },
  ]) assert.throws(() => assertDeploymentConfiguration(config))
})

test('database addresses reject ambiguous paths, plaintext endpoints and credentials', () => {
  for (const url of ['file:', 'file://server/path.db', 'file:db?mode=ro', 'file:db#fragment', 'file:db\u0000', 'libsql://scolo.example.turso.io']) {
    assert.throws(() => assertDatabaseConfiguration({ ...local, DATABASE_URL: url }))
  }
  for (const url of ['http://scolo.example.turso.io', 'libsql://localhost', 'https://127.0.0.1', 'https://[::1]', 'libsql://server.local', 'libsql://user:secret@scolo.example.turso.io', 'libsql://scolo.example.turso.io/path', 'libsql://scolo.example.turso.io?authToken=secret', 'libsql://scolo.example.turso.io#fragment']) {
    assert.throws(() => assertDatabaseConfiguration({ ...publicConfig, DATABASE_URL: url }))
  }
  assert.throws(() => createLocalDatabaseClient(publicConfig.DATABASE_URL))
})

test('tweet publication stays disabled locally and requires all publication credentials', () => {
  const credentials = { BUFFER_API_KEY: 'test-only', BUFFER_CHANNEL_ID: 'channel-test-only' }
  assert.doesNotThrow(() => assertDeploymentConfiguration({ ...publicConfig, SCOLO_TWEETS_ENABLED: 'false' }))
  assert.doesNotThrow(() => assertDeploymentConfiguration({ ...publicConfig, ...credentials, SCOLO_TWEETS_ENABLED: 'true' }))
  assert.throws(() => assertDeploymentConfiguration({ ...local, ...credentials, SCOLO_TWEETS_ENABLED: 'true' }))
  assert.throws(() => assertDeploymentConfiguration({ ...publicConfig, SCOLO_TWEETS_ENABLED: 'true' }))
  for (const key of Object.keys(credentials)) {
    assert.throws(() => assertDeploymentConfiguration({ ...publicConfig, ...credentials, [key]: ' ', SCOLO_TWEETS_ENABLED: 'true' }))
  }
})

test('application origin must be exact and public mode requires HTTPS', () => {
  assert.equal(applicationOrigin(local), 'http://localhost:3092')
  assert.equal(applicationOrigin({ ...publicConfig, APP_URL: 'https://scolo.example.com/' }), 'https://scolo.example.com')
  for (const appUrl of ['http://scolo.example.com', 'https://scolo.example.com/path', 'https://scolo.example.com?key=x', 'https://scolo.example.com/#fragment', 'https://user:pass@scolo.example.com', 'https://localhost', 'https://127.0.0.1']) {
    assert.throws(() => applicationOrigin({ ...publicConfig, APP_URL: appUrl }))
  }
})

test('request hosts fail closed and do not trust lookalikes or forwarded-style values', () => {
  for (const host of ['localhost:3092', '127.0.0.1:3092', '[::1]:3092']) assert.equal(isLoopbackHost(host), true)
  for (const host of [undefined, '', 'localhost.evil.example', 'localhost:3092/evil', 'localhost:3092@evil.example', 'localhost:3092?x', 'localhost:3092,evil.example', ' localhost:3092']) assert.equal(isLoopbackHost(host), false)
  assert.equal(isAllowedApplicationHost('scolo.example.com', publicConfig), true)
  assert.equal(isAllowedApplicationHost('localhost:3092', local), true)
  for (const host of ['localhost:3092', 'scolo.example.com:444', 'evil.example.com', 'scolo.example.com@evil.example.com', undefined]) assert.equal(isAllowedApplicationHost(host, publicConfig), false)
  assert.equal(isAllowedApplicationHost('scolo.example.com', local), false)
  assert.equal(isAllowedApplicationHost('scolo.example.com', { ...publicConfig, SCOLO_WALLET_MODE: 'unknown' } as unknown as ApplicationConfiguration), false)
})

test('mutations require the configured origin and host even for authenticated callers', () => {
  const request = { host: 'scolo.example.com', origin: 'https://scolo.example.com', fetchSite: 'same-origin' }
  assert.equal(isSameOriginMutation(request, publicConfig), true)
  for (const variation of [
    { origin: undefined }, { origin: 'null' }, { origin: 'http://scolo.example.com' },
    { origin: 'https://evil.example.com' }, { origin: 'https://scolo.example.com/' },
    { host: 'evil.example.com' }, { host: undefined }, { fetchSite: 'cross-site' },
    { fetchSite: ['same-origin', 'cross-site'] },
  ]) assert.equal(isSameOriginMutation({ ...request, ...variation }, publicConfig), false)
  assert.equal(isSameOriginMutation({ host: 'localhost:3092', origin: 'http://localhost:3092' }, local), true)
  assert.equal(isSameOriginMutation({ host: 'localhost:3092', origin: 'http://localhost:3093' }, local), false)
})

test('admin identity is a server allowlist with no default or partial match', () => {
  assert.equal(isConfiguredAdmin('user_admin', ' user_admin, user_other '), true)
  assert.equal(isConfiguredAdmin(null, 'user_admin'), false)
  assert.equal(isConfiguredAdmin('', ','), false)
  assert.equal(isConfiguredAdmin('user_admin', ''), false)
  assert.equal(isConfiguredAdmin('user_ad', 'user_admin'), false)
  assert.equal(isConfiguredAdmin('user_dev_admin', 'user_prod_admin'), false)
})

test('importing the database adapter performs no filesystem or database initialization', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'scolo-config-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const database = join(directory, 'uncreated', 'build.db')
  const adapter = pathToFileURL(resolve('src/server/db/index.ts')).href
  execFileSync(process.execPath, ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e', `await import(${JSON.stringify(adapter)})`], {
    cwd: directory, env: { ...process.env, DATABASE_URL: `file:${database}`, SCOLO_WALLET_MODE: 'local' }, stdio: 'pipe',
  })
  await assert.rejects(access(join(directory, 'uncreated')))
})
