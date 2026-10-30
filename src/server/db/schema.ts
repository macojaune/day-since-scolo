import { relations, sql } from 'drizzle-orm'
import {
  index,
  int,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
// export const createTable = sqliteTableCreator((name) => `${name}`)

export const users = sqliteTable('user', {
  id: text('id').notNull().primaryKey(),
  name: text('name', { length: 255 }),
  email: text('email', { length: 255 }).notNull(),
  emailVerified: int('emailVerified', {
    mode: 'timestamp',
  }).default(sql`(unixepoch())`),
  image: text('image', { length: 255 }),
})

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
}))

export const accounts = sqliteTable(
  'account',
  {
    userId: text('userId', { length: 255 })
      .notNull()
      .references(() => users.id),
    type: text('type', { length: 255 })
      .$type<'oauth' | 'oidc' | 'email' | 'credentials' | 'webauthn'>()
      .notNull(),
    provider: text('provider', { length: 255 }).notNull(),
    providerAccountId: text('providerAccountId', { length: 255 }).notNull(),
    refresh_token: text('refreshToken'),
    access_token: text('accessToken'),
    expires_at: int('expiresAt'),
    token_type: text('tokenType', { length: 255 }),
    scope: text('scope', { length: 255 }),
    id_token: text('idToken'),
    session_state: text('sessionState', { length: 255 }),
  },
  (account) => ({
    compoundKey: primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
    userIdIdx: index('account_user_id_idx').on(account.userId),
  })
)

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}))

export const sessions = sqliteTable(
  'session',
  {
    sessionToken: text('sessionToken', { length: 255 }).notNull().primaryKey(),
    userId: text('userId', { length: 255 })
      .notNull()
      .references(() => users.id),
    expires: int('expires', { mode: 'timestamp' }).notNull(),
  },
  (session) => ({
    userIdIdx: index('session_userId_idx').on(session.userId),
  })
)

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}))

export const verificationTokens = sqliteTable(
  'verificationToken',
  {
    identifier: text('identifier', { length: 255 }).notNull(),
    token: text('token', { length: 255 }).notNull(),
    expires: int('expires', { mode: 'timestamp' }).notNull(),
  },
  (vt) => ({
    compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
  })
)
export const authenticators = sqliteTable(
  'authenticator',
  {
    credentialID: text('credentialID').notNull().unique(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerAccountId: text('providerAccountId').notNull(),
    credentialPublicKey: text('credentialPublicKey').notNull(),
    counter: integer('counter').notNull(),
    credentialDeviceType: text('credentialDeviceType').notNull(),
    credentialBackedUp: integer('credentialBackedUp', {
      mode: 'boolean',
    }).notNull(),
    transports: text('transports'),
  },
  (authenticator) => ({
    compositePK: primaryKey({
      columns: [authenticator.userId, authenticator.credentialID],
    }),
  })
)

// todo replace and standardize
export const scoloData = sqliteTable('scolo-data', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  tool: text('tool'),
})
export type Encounter = typeof scoloData.$inferSelect

export const bets = sqliteTable('bets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('userId').notNull(),
  spawnId: integer('spawnId').notNull(),
  estimationDate: integer('estimationDate', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
})

export const credits = sqliteTable('credits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('userId').notNull(),
  oldCredit: integer('oldCredit').notNull(),
  newCredit: integer('newCredit').notNull(),
  transactionType: text('transactionType', { enum: ['bet', 'buy', 'reset'] }),
  transactionId: integer('transactionId'),
  createdAt: integer('created_at', { mode: 'timestamp' }),
})

export const betsRelations = relations(bets, ({ one }) => ({
  spawn: one(scoloData, { fields: [bets.spawnId], references: [scoloData.id] }),
}))

// The historical tables above are preserved during the Clerk transition. New
// local-game state lives in its own tables and never reuses legacy credits.
export const scoloPlayers = sqliteTable('scolo_players', {
  id: text('id').primaryKey(),
  clerkUserId: text('clerk_user_id').notNull().unique(),
  displayName: text('display_name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const scoloWallets = sqliteTable('scolo_wallets', {
  playerId: text('player_id').primaryKey().references(() => scoloPlayers.id),
  balance: integer('balance').notNull().default(0),
})

export const scoloRounds = sqliteTable('scolo_rounds', {
  id: text('id').primaryKey(),
  openedAt: integer('opened_at', { mode: 'timestamp_ms' }).notNull(),
  status: text('status', { enum: ['open', 'settled'] }).notNull(),
  closedAt: integer('closed_at', { mode: 'timestamp_ms' }),
})

export const scoloPredictions = sqliteTable('scolo_predictions', {
  id: text('id').primaryKey(),
  playerId: text('player_id').notNull().references(() => scoloPlayers.id),
  roundId: text('round_id').notNull().references(() => scoloRounds.id),
  predictedAt: integer('predicted_at', { mode: 'timestamp_ms' }).notNull(),
  stake: integer('stake').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  status: text('status', { enum: ['active', 'won', 'lost', 'refunded'] }).notNull(),
  payout: integer('payout').notNull().default(0),
})

export const scoloWalletEntries = sqliteTable('scolo_wallet_entries', {
  id: text('id').primaryKey(),
  playerId: text('player_id').notNull().references(() => scoloPlayers.id),
  amount: integer('amount').notNull(),
  kind: text('kind', { enum: ['welcome', 'reserve', 'payout', 'refund', 'fixture', 'round_bonus', 'arcade_bonus'] }).notNull(),
  reference: text('reference').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const scoloSettlements = sqliteTable('scolo_settlements', {
  roundId: text('round_id').primaryKey().references(() => scoloRounds.id),
  observedAt: integer('observed_at', { mode: 'timestamp_ms' }).notNull(),
  tool: text('tool').notNull(),
  declaredAt: integer('declared_at', { mode: 'timestamp_ms' }).notNull(),
  pot: integer('pot').notNull(),
  totalRefunded: integer('total_refunded').notNull(),
  winningDistanceMs: integer('winning_distance_ms'),
  nextRoundId: text('next_round_id').notNull().references(() => scoloRounds.id),
  appearanceId: integer('appearance_id').notNull().references(() => scoloData.id),
})
