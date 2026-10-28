import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Client, Row } from '@libsql/client'
import { createDatabaseClient } from '../src/server/db'
import { GAME_SCHEMA_TABLES, GAME_SCHEMA_VERSION, migrateGameDatabase } from '../src/server/db/local-migrations'
import { ensurePlayerInTransaction } from '../src/server/game/player'

type Connection = Pick<Client, 'execute'>
interface PreparationOptions { apply?: boolean; adminClerkId?: string; adminName?: string }
interface TableSnapshot { count: number; hash: string; rows: string[] }
type Snapshot = Record<string, TableSnapshot>

function quote(name: string) { return `"${name.replaceAll('"', '""')}"` }
function encode(value: unknown): unknown {
  if (typeof value === 'bigint') return { integer: value.toString() }
  if (value instanceof ArrayBuffer) return { blob: Buffer.from(value).toString('base64') }
  if (ArrayBuffer.isView(value)) return { blob: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64') }
  return value
}

async function snapshot(connection: Connection): Promise<Snapshot> {
  const names = (await connection.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).rows
  const tables: Snapshot = {}
  for (const row of names) {
    const name = String(row.name)
    const result = await connection.execute(`SELECT * FROM ${quote(name)}`)
    const rows = result.rows.map(values => JSON.stringify(result.columns.map((_, index) => encode(values[index])))).sort()
    tables[name] = { count: rows.length, hash: createHash('sha256').update(JSON.stringify({ columns: result.columns, rows })).digest('hex'), rows }
  }
  return tables
}

const insertableTables = new Set(['scolo_players', 'scolo_wallets', 'scolo_wallet_entries', 'scolo_schema_migrations'])
function assertPreserved(before: Snapshot, after: Snapshot) {
  for (const [name, original] of Object.entries(before)) {
    const current = after[name]
    if (!current) throw new Error(`La table existante ${name} a disparu.`)
    if (!insertableTables.has(name)) {
      if (original.hash !== current.hash) throw new Error(`La table existante ${name} a été modifiée.`)
    } else {
      const counts = new Map<string, number>()
      for (const row of current.rows) counts.set(row, (counts.get(row) ?? 0) + 1)
      for (const row of original.rows) {
        const remaining = counts.get(row) ?? 0
        if (!remaining) throw new Error(`Une donnée existante de ${name} a été modifiée.`)
        counts.set(row, remaining - 1)
      }
    }
  }
}

function validateOptions(options: PreparationOptions) {
  if (options.adminClerkId === undefined && options.adminName === undefined) return
  if (!options.adminClerkId || !/^user_[A-Za-z0-9]+$/.test(options.adminClerkId)) throw new Error('--admin-clerk-id exige un identifiant Clerk explicite.')
  if (!options.adminName?.trim() || options.adminName.length > 60 || /[\u0000-\u001f\u007f]/.test(options.adminName)) throw new Error('--admin-name exige un pseudo de 1 à 60 caractères.')
}

async function adminState(connection: Connection, options: PreparationOptions, tables: Snapshot) {
  if (!options.adminClerkId || !tables.scolo_players) return null
  const player = (await connection.execute({ sql: 'SELECT * FROM scolo_players WHERE clerk_user_id = ?', args: [options.adminClerkId] })).rows[0]
  if (!player) return null
  const wallet = tables.scolo_wallets
    ? (await connection.execute({ sql: 'SELECT balance FROM scolo_wallets WHERE player_id = ?', args: [String(player.id)] })).rows[0]
    : null
  if (!wallet) throw new Error('Ce joueur existe mais son portefeuille manque ; aucune réparation implicite ne sera appliquée.')
  return { playerId: String(player.id), clerkUserId: String(player.clerk_user_id), displayName: String(player.display_name), balance: Number(wallet.balance) }
}

/** Explicit preparation only: never creates a round, a prediction or an outbound message. */
export async function prepareGameDatabase(client: Client, options: PreparationOptions = {}) {
  validateOptions(options)
  const read = await client.transaction('read')
  let before: Snapshot
  let existingAdmin: Awaited<ReturnType<typeof adminState>>
  let versionPresent: boolean
  try {
    before = await snapshot(read)
    existingAdmin = await adminState(read, options, before)
    versionPresent = Boolean(before.scolo_schema_migrations && (await read.execute({ sql: 'SELECT version FROM scolo_schema_migrations WHERE version = ?', args: [GAME_SCHEMA_VERSION] })).rows.length)
  } finally { read.close() }
  const missingTables = GAME_SCHEMA_TABLES.filter(name => !before[name])
  const plan = {
    schemaVersion: GAME_SCHEMA_VERSION,
    migrationNeeded: !versionPresent || missingTables.length > 0,
    tablesToCreate: missingTables,
    administrator: options.adminClerkId ? {
      clerkUserId: options.adminClerkId,
      displayName: existingAdmin?.displayName ?? options.adminName!,
      action: existingAdmin ? 'keep-existing' : 'create-player-with-3-zikak',
      currentBalance: existingAdmin?.balance ?? null,
      accessControl: 'SCOLO_ADMIN_USER_IDS reste requis côté serveur ; ce script ne modifie aucun droit Clerk.',
    } : null,
    opensRound: false,
    publishesMessages: false,
  }
  if (!options.apply) return {
    mode: 'read-only', applied: false, plan,
    tables: Object.fromEntries(Object.entries(before).map(([name, table]) => [name, { count: table.count, hash: table.hash }])),
  }

  await migrateGameDatabase(client)
  const transaction = await client.transaction('write')
  let after: Snapshot
  let administrator: typeof existingAdmin
  try {
    // Detect changes between the dry-run snapshot and this write transaction.
    assertPreserved(before, await snapshot(transaction))
    let player: Row | null = null
    if (options.adminClerkId) player = await ensurePlayerInTransaction(transaction, { userId: options.adminClerkId, displayName: options.adminName }, { now: Date.now() })
    after = await snapshot(transaction)
    assertPreserved(before, after)
    administrator = await adminState(transaction, options, after)
    if (player && !administrator) throw new Error('Le joueur préparé est introuvable.')
    const integrity = (await transaction.execute('PRAGMA integrity_check')).rows.map(row => String(row[0]))
    const foreignKeyErrors = (await transaction.execute('PRAGMA foreign_key_check')).rows.length
    if (integrity.join(',') !== 'ok' || foreignKeyErrors) throw new Error('Échec du contrôle d’intégrité après préparation.')
    await transaction.commit()
  } catch (error) {
    await transaction.rollback()
    throw error
  } finally { transaction.close() }
  return {
    mode: 'apply', applied: true, plan, administrator,
    tables: Object.fromEntries(Object.entries(after).map(([name, table]) => [name, { before: before[name]?.count ?? 0, after: table.count, hash: table.hash }])),
    existingDataPreserved: true, opensRound: false, publishesMessages: false, integrity: 'ok',
  }
}

async function main() {
  const args = process.argv.slice(2)
  const options: PreparationOptions = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--apply' && options.apply === undefined) options.apply = true
    else if ((arg === '--admin-clerk-id' && options.adminClerkId === undefined) || (arg === '--admin-name' && options.adminName === undefined)) {
      const value = args[++i]
      if (!value || value.startsWith('--')) throw new Error(`Valeur manquante pour ${arg}.`)
      if (arg === '--admin-clerk-id') options.adminClerkId = value
      else options.adminName = value
    } else throw new Error(`Argument inconnu ou répété : ${arg}.`)
  }
  validateOptions(options)
  const url = process.env.DATABASE_URL
  const mode = process.env.SCOLO_WALLET_MODE
  if (!url || (mode !== 'local' && mode !== 'scolo')) throw new Error('DATABASE_URL et SCOLO_WALLET_MODE=local|scolo sont requis.')
  if (mode === 'local' && !existsSync(resolve(url.slice(5)))) throw new Error('La copie SQLite locale doit déjà exister ; ce script ne crée pas de base vide implicitement.')
  const client = createDatabaseClient({ SCOLO_WALLET_MODE: mode, DATABASE_URL: url, DATABASE_AUTH_TOKEN: process.env.DATABASE_AUTH_TOKEN })
  try {
    const report = await prepareGameDatabase(client, options)
    console.log(JSON.stringify({ target: url, ...report }, null, 2))
  } finally { client.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Préparation interrompue.')
    process.exitCode = 1
  })
}
