import type { Client } from '@libsql/client'
import { randomUUID } from 'node:crypto'
import { createGameService } from './service'

/** Explicit development fixtures. Never seeds a nonempty store or global Zikak. */
export async function seedLocalDemo(client: Client, now = new Date()) {
  if (client.protocol !== 'file') throw new Error('Les données de démonstration exigent une base SQLite locale.')
  await createGameService(client, { now: () => now })
  const transaction = await client.transaction('write')
  try {
    const existing = await transaction.execute("SELECT value FROM scolo_local_meta WHERE key = 'demo-seed-v1'")
    if (existing.rows.length) { await transaction.commit(); return { status: 'already-seeded' as const } }
    const count = await transaction.execute('SELECT (SELECT COUNT(*) FROM scolo_players) + (SELECT COUNT(*) FROM scolo_predictions) + (SELECT COUNT(*) FROM "scolo-data") AS count')
    if (Number(count.rows[0]!.count) > 0) { await transaction.commit(); return { status: 'not-empty' as const } }

    const minute = Math.floor(now.getTime() / 60_000) * 60_000
    const day = 86_400_000
    const round = (await transaction.execute("SELECT id FROM scolo_rounds WHERE status = 'open'")).rows[0]!
    const roundId = String(round.id)
    await transaction.execute({ sql: 'UPDATE scolo_rounds SET opened_at = ? WHERE id = ?', args: [minute - 9 * day, roundId] })
    for (const [offset, tool] of [[9, 'sandale'], [22, 'digrain'], [31, 'coutelas']] as const) {
      await transaction.execute({ sql: 'INSERT INTO "scolo-data" (created_at, tool) VALUES (?, ?)', args: [Math.floor((minute - offset * day) / 1000), tool] })
    }
    const samples = [
      { name: 'Ti Jo · démo', balance: 80, stake: 30, predictedAt: minute + day },
      { name: 'Maëva · démo', balance: 70, stake: 20, predictedAt: minute + 2 * day },
      { name: 'Ludo · démo', balance: 50, stake: 10, predictedAt: minute + 3 * day },
    ]
    for (const [index, sample] of samples.entries()) {
      const id = randomUUID()
      const ticketId = randomUUID()
      const createdAt = minute - (3 - index) * 3_600_000
      await transaction.execute({ sql: 'INSERT INTO scolo_players (id, clerk_user_id, display_name, created_at) VALUES (?, ?, ?, ?)', args: [id, `local-fixture-${index}`, sample.name, minute - 8 * day] })
      await transaction.execute({ sql: 'INSERT INTO scolo_wallets (player_id, balance) VALUES (?, ?)', args: [id, sample.balance - sample.stake] })
      await transaction.execute({ sql: "INSERT INTO scolo_wallet_entries (id, player_id, amount, kind, reference, created_at) VALUES (?, ?, ?, 'fixture', ?, ?)", args: [randomUUID(), id, sample.balance, `fixture:${id}`, minute - 8 * day] })
      await transaction.execute({ sql: "INSERT INTO scolo_predictions (id, player_id, round_id, predicted_at, stake, created_at, idempotency_key, status, payout) VALUES (?, ?, ?, ?, ?, ?, 'fixture-v1', 'active', 0)", args: [ticketId, id, roundId, sample.predictedAt, sample.stake, createdAt] })
      await transaction.execute({ sql: "INSERT INTO scolo_wallet_entries (id, player_id, amount, kind, reference, created_at) VALUES (?, ?, ?, 'reserve', ?, ?)", args: [randomUUID(), id, -sample.stake, `prediction:${ticketId}`, createdAt] })
    }
    await transaction.execute("INSERT INTO scolo_local_meta (key, value) VALUES ('demo-seed-v1', 'Données fictives locales, sans lien avec le portefeuille global Zikak')")
    await transaction.commit()
    return { status: 'seeded' as const }
  } catch (error) { await transaction.rollback(); throw error } finally { transaction.close() }
}
