import { randomUUID } from 'node:crypto'
import type { Row, Transaction } from '@libsql/client'
import { GameError, type PlayerInput } from './types'

/** Shared by sign-in and explicit provisioning. Caller owns the write transaction. */
export async function ensurePlayerInTransaction(transaction: Transaction, input: PlayerInput, options: {
  now: number
  id?: () => string
}): Promise<Row> {
  if (typeof input.userId !== 'string' || !input.userId.trim() || input.userId.length > 200) {
    throw new GameError('INVALID_INPUT', 'Identité invalide.')
  }
  const existing = (await transaction.execute({ sql: 'SELECT * FROM scolo_players WHERE clerk_user_id = ?', args: [input.userId] })).rows[0]
  if (existing) return existing
  const newId = options.id ?? randomUUID
  const id = newId()
  const displayName = input.displayName?.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) || 'Un joueur'
  await transaction.execute({
    sql: 'INSERT INTO scolo_players (id, clerk_user_id, display_name, created_at) VALUES (?, ?, ?, ?)',
    args: [id, input.userId, displayName, options.now],
  })
  await transaction.execute({ sql: 'INSERT INTO scolo_wallets (player_id, balance) VALUES (?, 3)', args: [id] })
  await transaction.execute({
    sql: 'INSERT INTO scolo_wallet_entries (id, player_id, amount, kind, reference, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: [newId(), id, 3, 'welcome', `welcome:${id}`, options.now],
  })
  return { id, clerk_user_id: input.userId, display_name: displayName, created_at: options.now } as unknown as Row
}
