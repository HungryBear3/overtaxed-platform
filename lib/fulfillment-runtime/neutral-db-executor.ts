export type NeutralDbExecutor = {
  $queryRaw<T>(query: unknown): Promise<T>
  $executeRaw(query: unknown): Promise<number>
  $transaction<T>(work: (tx: NeutralDbExecutor) => Promise<T>): Promise<T>
}

/** Use a caller-owned transaction when supplied; production keeps its client transaction. */
export function inNeutralTransaction<T>(
  client: NeutralDbExecutor,
  executor: NeutralDbExecutor | undefined,
  work: (tx: NeutralDbExecutor) => Promise<T>,
): Promise<T> {
  return executor ? work(executor) : client.$transaction(work)
}

/**
 * The minimal `pg` surface a caller-owned transaction needs. Deliberately not
 * the whole client: nothing here may connect, disconnect, BEGIN, COMMIT or
 * ROLLBACK. Opening and ending the transaction stays the caller's job.
 */
export type NeutralSqlClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>
}

/** A `Prisma.Sql` as this adapter consumes it: parameterized text plus values. */
type NeutralStatement = { text: string; values: readonly unknown[] }

function statement(query: unknown): NeutralStatement {
  const sql = query as Partial<NeutralStatement> | null
  // Production helpers always pass a Prisma.sql template. Anything else would
  // mean an interpolated string reached the driver, so this fails closed rather
  // than forwarding text whose parameter binding cannot be verified.
  if (!sql || typeof sql.text !== "string" || !Array.isArray(sql.values))
    throw new Error("Caller-owned executor accepts only parameterized Prisma.sql statements")
  return { text: sql.text, values: sql.values }
}

/**
 * Bind the production neutral helpers to a transaction the CALLER already
 * opened on one connection.
 *
 * Why this exists: the synthetic Preview acceptance must exercise the real
 * helpers and then discard every row. A helper that opened its own client
 * transaction would commit independently of the caller and could not be rolled
 * back, so the helpers take an optional executor (see [[inNeutralTransaction]])
 * and this adapter is what that executor is.
 *
 * `$transaction` maps to a SAVEPOINT rather than a nested BEGIN, which
 * PostgreSQL does not have. That is not a convenience: several stores signal an
 * internal abort by THROWING out of `$transaction` and then catching it to
 * return a blocker (`PacketDownloadRollback`, `DeliveryRollback`). Without a
 * savepoint those partial writes would survive inside the caller's transaction
 * while the store reported a refusal — precisely the divergence this runner
 * exists to rule out. Everything still lives in the caller's single
 * transaction, so one final ROLLBACK discards all of it.
 */
export function createNeutralTransactionExecutor(client: NeutralSqlClient): NeutralDbExecutor {
  let depth = 0
  const executor: NeutralDbExecutor = {
    async $queryRaw<T>(query: unknown): Promise<T> {
      const { text, values } = statement(query)
      return (await client.query(text, [...values])).rows as unknown as T
    },
    async $executeRaw(query: unknown): Promise<number> {
      const { text, values } = statement(query)
      return (await client.query(text, [...values])).rowCount ?? 0
    },
    async $transaction<T>(work: (tx: NeutralDbExecutor) => Promise<T>): Promise<T> {
      // Nesting depth, not a random value: the name is interpolated into SQL, so
      // it must be an identifier this module produced and nothing else.
      const name = `ot_neutral_sp_${++depth}`
      try {
        await client.query(`SAVEPOINT ${name}`)
        try {
          const result = await work(executor)
          await client.query(`RELEASE SAVEPOINT ${name}`)
          return result
        } catch (error) {
          // The original failure is what the caller must see; a recovery
          // statement that also fails (a dead connection, an already-aborted
          // transaction) must not replace it with a less informative one.
          try {
            await client.query(`ROLLBACK TO SAVEPOINT ${name}`)
            await client.query(`RELEASE SAVEPOINT ${name}`)
          } catch {
            /* preserve the original error */
          }
          throw error
        }
      } finally {
        depth--
      }
    },
  }
  return executor
}
