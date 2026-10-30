import { arcadeSchema } from '../arcade/schema'
import type { Client } from '@libsql/client'
import { participationSchema } from '../social/participation-tweets'
import { bufferPostsSchema, participationBufferPostsSchema } from '../social/buffer-outbox'
import { tweetOutboxSchema } from '../social/tweet-outbox'
import { zikakOutboxSchema } from '../zikak/outbox'
import { pointJobsSchema } from '../zikak/jobs'

export const GAME_SCHEMA_VERSION = '2026-10-30-social-arcade-v5'

// Repeatable bootstrap. Historical auth, credits and bets are neither
// rewritten nor considered spendable Zikak. CHECKs also protect direct SQL use.
const walletEntriesDefinition = `(
  id TEXT PRIMARY KEY NOT NULL,
  player_id TEXT NOT NULL REFERENCES scolo_players(id),
  amount INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('welcome', 'reserve', 'payout', 'refund', 'fixture', 'round_bonus', 'arcade_bonus')),
  reference TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
)`
const statements = [
  tweetOutboxSchema,
  bufferPostsSchema,
  `CREATE TABLE IF NOT EXISTS scolo_schema_migrations (
    version TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "scolo-data" (
    id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER, tool TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS scolo_players (
    id TEXT PRIMARY KEY NOT NULL,
    clerk_user_id TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS scolo_wallets (
    player_id TEXT PRIMARY KEY NOT NULL REFERENCES scolo_players(id),
    balance INTEGER NOT NULL CHECK (balance >= 0 AND balance <= 9007199254740991)
  )`,
  `CREATE TABLE IF NOT EXISTS scolo_rounds (
    id TEXT PRIMARY KEY NOT NULL,
    opened_at INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'settled')),
    closed_at INTEGER
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS scolo_one_open_round ON scolo_rounds(status) WHERE status = 'open'`,
  `CREATE TABLE IF NOT EXISTS scolo_predictions (
    id TEXT PRIMARY KEY NOT NULL,
    player_id TEXT NOT NULL REFERENCES scolo_players(id),
    round_id TEXT NOT NULL REFERENCES scolo_rounds(id),
    predicted_at INTEGER NOT NULL,
    stake INTEGER NOT NULL CHECK (stake >= 1 AND stake <= 9007199254740991),
    created_at INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'won', 'lost', 'refunded')),
    payout INTEGER NOT NULL DEFAULT 0 CHECK (payout >= 0),
    UNIQUE (player_id, round_id, idempotency_key)
  )`,
  `CREATE INDEX IF NOT EXISTS scolo_predictions_round_date ON scolo_predictions(round_id, predicted_at)`,
  `CREATE INDEX IF NOT EXISTS scolo_predictions_player ON scolo_predictions(player_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS scolo_wallet_entries ${walletEntriesDefinition}`,
  `CREATE TABLE IF NOT EXISTS scolo_settlements (
    round_id TEXT PRIMARY KEY NOT NULL REFERENCES scolo_rounds(id),
    observed_at INTEGER NOT NULL,
    tool TEXT NOT NULL,
    declared_at INTEGER NOT NULL,
    pot INTEGER NOT NULL CHECK (pot >= 0),
    total_refunded INTEGER NOT NULL CHECK (total_refunded >= 0),
    winning_distance_ms INTEGER,
    next_round_id TEXT NOT NULL REFERENCES scolo_rounds(id),
    appearance_id INTEGER NOT NULL REFERENCES "scolo-data"(id)
  )`,
  `CREATE TABLE IF NOT EXISTS scolo_history_additions (
    idempotency_key TEXT PRIMARY KEY NOT NULL,
    observed_at INTEGER NOT NULL,
    tool TEXT NOT NULL,
    appearance_id INTEGER NOT NULL UNIQUE REFERENCES "scolo-data"(id),
    actor_clerk_user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS scolo_local_meta (
    key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL
  )`,
  ...zikakOutboxSchema,
  ...pointJobsSchema,
  ...arcadeSchema,
  ...participationSchema,
  participationBufferPostsSchema,
]

/** The dry-run lists tables from the same statements that the migration executes. */
export const GAME_SCHEMA_TABLES = Object.freeze(statements.flatMap(statement => {
  const match = /^CREATE TABLE IF NOT EXISTS "?([\w-]+)"?\s*\(/.exec(statement)
  return match?.[1] ? [match[1]] : []
}))

/** Explicit additive migration. Public runtime never calls this function. */
export async function migrateGameDatabase(client: Client) {
  await client.execute('PRAGMA foreign_keys = ON')
  // busy_timeout is a local SQLite setting and is rejected by Turso's HTTP API.
  if (client.protocol === 'file') await client.execute('PRAGMA busy_timeout = 5000')
  const transaction = await client.transaction('write')
  try {
    for (const statement of statements) await transaction.execute(statement)
    const definition = (await transaction.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'scolo_wallet_entries'")).rows[0]!
    if (!String(definition.sql).includes("'arcade_bonus'")) {
      // SQLite cannot ALTER a CHECK. Preserve every entry and any explicit
      // index/trigger while replacing only this table, in the same transaction.
      const attachments = (await transaction.execute("SELECT sql FROM sqlite_master WHERE tbl_name = 'scolo_wallet_entries' AND type IN ('index', 'trigger') AND sql IS NOT NULL")).rows
      await transaction.execute(`CREATE TABLE scolo_wallet_entries_next ${walletEntriesDefinition}`)
      await transaction.execute('INSERT INTO scolo_wallet_entries_next (id, player_id, amount, kind, reference, created_at) SELECT id, player_id, amount, kind, reference, created_at FROM scolo_wallet_entries')
      await transaction.execute('DROP TABLE scolo_wallet_entries')
      await transaction.execute('ALTER TABLE scolo_wallet_entries_next RENAME TO scolo_wallet_entries')
      for (const attachment of attachments) await transaction.execute(String(attachment.sql))
    }
    await transaction.execute({
      sql: 'INSERT INTO scolo_schema_migrations (version, applied_at) VALUES (?, ?) ON CONFLICT(version) DO NOTHING',
      args: [GAME_SCHEMA_VERSION, Date.now()],
    })
    await transaction.commit()
  } catch (error) {
    await transaction.rollback()
    throw error
  } finally {
    transaction.close()
  }
}

/** The local bootstrap refuses remote clients even if called outside the CLI. */
export async function migrateLocalDatabase(client: Client) {
  if (client.protocol !== 'file') throw new Error('Le bootstrap local exige une base SQLite locale.')
  return migrateGameDatabase(client)
}
