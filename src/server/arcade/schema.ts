export const arcadeSchema = [
    `CREATE TABLE IF NOT EXISTS scolo_arcade_runs (
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, rules TEXT NOT NULL,
      seed INTEGER NOT NULL, started_at INTEGER NOT NULL, rate_key TEXT NOT NULL,
      owner_id TEXT, elapsed_ms INTEGER, crushed INTEGER, payload_hash TEXT,
      claimed_by TEXT, claimed_at INTEGER
    )`,
    'CREATE INDEX IF NOT EXISTS scolo_arcade_rate ON scolo_arcade_runs(rate_key, started_at)',
    `CREATE TABLE IF NOT EXISTS scolo_arcade_bests (
      rules TEXT NOT NULL, user_id TEXT NOT NULL, display_name TEXT NOT NULL,
      elapsed_ms INTEGER NOT NULL CHECK(elapsed_ms > 0), crushed INTEGER NOT NULL CHECK(crushed >= 0),
      claimed_at INTEGER NOT NULL, run_id TEXT NOT NULL UNIQUE REFERENCES scolo_arcade_runs(id),
      PRIMARY KEY(rules, user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS scolo_arcade_rewards (
      user_id TEXT PRIMARY KEY NOT NULL, player_id TEXT NOT NULL REFERENCES scolo_players(id),
      total INTEGER NOT NULL CHECK(total BETWEEN 1 AND 3), updated_at INTEGER NOT NULL
    )`,
]
