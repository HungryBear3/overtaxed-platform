/** @jest-environment node */
import {
  createNeutralTransactionExecutor,
  inNeutralTransaction,
  type NeutralDbExecutor,
} from "@/lib/fulfillment-runtime/neutral-db-executor"

function executor(): NeutralDbExecutor {
  return {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  }
}

describe("neutral transaction executor", () => {
  it("runs directly on a caller-owned executor without nesting a transaction", async () => {
    const client=executor(),tx=executor(),work=jest.fn(async db=>db)
    await expect(inNeutralTransaction(client,tx,work)).resolves.toBe(tx)
    expect(work).toHaveBeenCalledWith(tx)
    expect(client.$transaction).not.toHaveBeenCalled()
    expect(tx.$transaction).not.toHaveBeenCalled()
  })

  it("preserves the existing production client transaction by default", async () => {
    const client=executor(),tx=executor(),work=jest.fn(async db=>db)
    ;(client.$transaction as jest.Mock).mockImplementation(async fn=>fn(tx))
    await expect(inNeutralTransaction(client,undefined,work)).resolves.toBe(tx)
    expect(client.$transaction).toHaveBeenCalledTimes(1)
    expect(work).toHaveBeenCalledWith(tx)
  })
})

describe("caller-owned SQL executor", () => {
  function client() {
    const statements: string[] = []
    const query = jest.fn(async (text: string) => {
      statements.push(text)
      return { rows: [{ ok: true }], rowCount: 3 }
    })
    return { statements, query }
  }

  it("forwards parameterized Prisma statements and never interpolates values", async () => {
    const db = client()
    const tx = createNeutralTransactionExecutor(db)
    await expect(
      tx.$queryRaw({ text: 'SELECT $1 AS "a"', values: ["x"] }),
    ).resolves.toEqual([{ ok: true }])
    await expect(
      tx.$executeRaw({ text: "UPDATE t SET a=$1", values: ["y"] }),
    ).resolves.toBe(3)
    expect(db.query).toHaveBeenNthCalledWith(1, 'SELECT $1 AS "a"', ["x"])
    expect(db.query).toHaveBeenNthCalledWith(2, "UPDATE t SET a=$1", ["y"])
  })

  it("refuses anything that is not a parameterized statement", async () => {
    const db = client()
    const tx = createNeutralTransactionExecutor(db)
    for (const bad of ["select 1", null, undefined, { text: "select 1" }])
      await expect(tx.$queryRaw(bad)).rejects.toThrow(/parameterized Prisma.sql/)
    expect(db.query).not.toHaveBeenCalled()
  })

  it("maps a nested store transaction to a savepoint it releases on success", async () => {
    const db = client()
    const tx = createNeutralTransactionExecutor(db)
    await expect(
      tx.$transaction(async (inner) => {
        expect(inner).toBe(tx)
        await inner.$executeRaw({ text: "insert into t values($1)", values: [1] })
        return "done"
      }),
    ).resolves.toBe("done")
    expect(db.statements).toEqual([
      "SAVEPOINT ot_neutral_sp_1",
      "insert into t values($1)",
      "RELEASE SAVEPOINT ot_neutral_sp_1",
    ])
  })

  it("rolls a store's internal abort back to its savepoint and rethrows", async () => {
    const db = client()
    const tx = createNeutralTransactionExecutor(db)
    const failure = new Error("PACKET_DOWNLOAD_ROLLBACK")
    await expect(
      tx.$transaction(async (inner) => {
        await inner.$executeRaw({ text: "insert into t values($1)", values: [1] })
        throw failure
      }),
    ).rejects.toBe(failure)
    expect(db.statements).toEqual([
      "SAVEPOINT ot_neutral_sp_1",
      "insert into t values($1)",
      "ROLLBACK TO SAVEPOINT ot_neutral_sp_1",
      "RELEASE SAVEPOINT ot_neutral_sp_1",
    ])
  })

  it("names nested savepoints by depth and reuses names only in sequence", async () => {
    const db = client()
    const tx = createNeutralTransactionExecutor(db)
    await tx.$transaction(async (outer) => outer.$transaction(async () => "deep"))
    await tx.$transaction(async () => "next")
    expect(db.statements).toEqual([
      "SAVEPOINT ot_neutral_sp_1",
      "SAVEPOINT ot_neutral_sp_2",
      "RELEASE SAVEPOINT ot_neutral_sp_2",
      "RELEASE SAVEPOINT ot_neutral_sp_1",
      "SAVEPOINT ot_neutral_sp_1",
      "RELEASE SAVEPOINT ot_neutral_sp_1",
    ])
  })

  it("preserves the original failure when the savepoint recovery also fails", async () => {
    const statements: string[] = []
    const db = {
      query: jest.fn(async (text: string) => {
        statements.push(text)
        if (text.startsWith("ROLLBACK TO")) throw new Error("connection lost")
        return { rows: [], rowCount: 0 }
      }),
    }
    const tx = createNeutralTransactionExecutor(db)
    const failure = new Error("original")
    await expect(
      tx.$transaction(async () => {
        throw failure
      }),
    ).rejects.toBe(failure)
    expect(statements).toEqual([
      "SAVEPOINT ot_neutral_sp_1",
      "ROLLBACK TO SAVEPOINT ot_neutral_sp_1",
    ])
  })
})
