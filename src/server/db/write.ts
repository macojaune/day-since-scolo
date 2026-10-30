import type { Client, Transaction } from '@libsql/client'

const queues = new WeakMap<Client, Promise<unknown>>()
/** Share one write queue across predictions, enrollment, scores and their rewards. */
export function databaseWrite<T>(client: Client, operation: (transaction: Transaction) => Promise<T>): Promise<T> {
  const run = async () => {
    const transaction = await client.transaction('write')
    try {
      const result = await operation(transaction)
      await transaction.commit()
      return result
    } catch (error) { await transaction.rollback(); throw error }
    finally { transaction.close() }
  }
  const pending = (queues.get(client) ?? Promise.resolve()).then(run, run)
  queues.set(client, pending.catch(() => undefined))
  return pending
}
