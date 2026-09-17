/** @jest-environment node */
const mockRetrieve = jest.fn()
const mockFindUnique = jest.fn()
const mockUpdateMany = jest.fn()
const mockCreate = jest.fn()
const mockDisconnect = jest.fn(async () => {})

jest.mock("stripe", () => ({
  __esModule: true,
  default: class {
    checkout = { sessions: { retrieve: (id: string) => mockRetrieve(id) } }
  },
}))
jest.mock("@/lib/db", () => ({
  prisma: {
    oTOrder: {
      findUnique: (args: unknown) => mockFindUnique(args),
      updateMany: (args: unknown) => mockUpdateMany(args),
      create: (args: unknown) => mockCreate(args),
    },
    $disconnect: () => mockDisconnect(),
  },
}))

import { readFileSync } from "node:fs"
import { join } from "node:path"

const SESSION_ID = "cs_live_recovery"
const RECOVERY_REASON = "MANUAL_RECOVERY_REQUIRES_CONTRACT_REVIEW"

const SESSION = {
  id: SESSION_ID,
  livemode: true,
  status: "complete",
  payment_status: "paid",
  amount_total: 49900,
  currency: "USD",
  metadata: { tier: "T2" },
  customer_details: { email: "Owner@Example.test", name: "Owner", phone: null },
}

type Row = Record<string, unknown>

/** A row the CAS can legitimately move into recovery. */
const OPEN: Row = {
  id: "ord_open",
  status: "AWAITING_PAYMENT",
  stripeSessionId: SESSION_ID,
  checkoutKey: "ck_open",
  contractKey: "ct_open",
  attempt: 1,
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  recoveryStripeSessionId: null,
  recoveryReason: null,
}

const HELD: Row = { ...OPEN, id: "ord_held", status: "SETTLEMENT_HOLD" }

const RECOVERED: Row = {
  ...OPEN,
  status: "PAID_RECOVERY_REQUIRED",
  recoveryStripeSessionId: SESSION_ID,
  recoveryReason: RECOVERY_REASON,
}

/**
 * The script looks the order up by `stripeSessionId`, then re-reads it by `id`
 * after the guarded write. `reread` is what the database actually persisted —
 * which is not necessarily what the update asked for, because
 * `ot_preserve_settlement_hold` rewrites `NEW.status` in a BEFORE UPDATE
 * trigger without failing the statement.
 */
function stage(initial: Row | null, reread: Row | null) {
  mockFindUnique.mockImplementation(async (args: { where: { id?: string; stripeSessionId?: string } }) =>
    args.where.stripeSessionId ? initial : reread,
  )
}

function rereads() {
  return mockFindUnique.mock.calls.filter((call) => call[0]?.where?.id !== undefined).length
}

const logs: string[] = []
const errors: string[] = []

async function runApply() {
  process.argv = ["node", "scripts/recover-paid-ot-order.ts", SESSION_ID, "--apply", "--i-have-approval"]
  process.env.STRIPE_SECRET_KEY = "sk_live_synthetic"
  process.env.OT_ORDER_RECOVERY_CONFIRM = SESSION_ID
  jest.resetModules()
  const script = require("../../scripts/recover-paid-ot-order") as { completed: Promise<void> }
  await script.completed
}

beforeEach(() => {
  jest.clearAllMocks()
  logs.length = 0
  errors.length = 0
  process.exitCode = undefined
  mockRetrieve.mockResolvedValue(SESSION)
  mockUpdateMany.mockResolvedValue({ count: 1 })
  jest.spyOn(console, "log").mockImplementation((value) => void logs.push(String(value)))
  jest.spyOn(console, "error").mockImplementation((value) => void errors.push(String(value)))
})

afterEach(() => {
  jest.restoreAllMocks()
  // Never let a script-under-test exit code leak into Jest's own exit status.
  process.exitCode = undefined
})

describe("recover-paid-ot-order script safety", () => {
  const source = readFileSync(join(process.cwd(), "scripts/recover-paid-ot-order.ts"), "utf8")

  it("never directly writes PAID or performs an unchecked upsert", () => {
    expect(source).not.toMatch(/status\s*:\s*["']PAID["']/)
    expect(source).not.toMatch(/oTOrder\.upsert\s*\(/)
  })

  it("stages manual recovery behind a checked CAS", () => {
    expect(source).toMatch(/PAID_RECOVERY_REQUIRED/)
    expect(source).toMatch(/TERMINAL_OR_SETTLED/)
    expect(source).toMatch(/oTOrder\.updateMany\s*\(/)
    expect(source).toMatch(/updated\.count\s*!==\s*1/)
    expect(source).toMatch(/recoveryStripeSessionId\s*:\s*sessionId/)
  })
})

describe("recover-paid-ot-order apply execution", () => {
  it("refuses a settlement-held order before attempting any write", async () => {
    stage(HELD, HELD)

    await runApply()

    expect(mockUpdateMany).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
    expect(errors.join("\n")).toContain("SETTLEMENT_HOLD")
    expect(logs.join("\n")).not.toContain('"written": true')
    expect(process.exitCode).toBe(1)
  })

  it("refuses when a concurrent hold was trigger-preserved despite the CAS matching one row", async () => {
    // The row was open at read time, went on hold before the update landed, and
    // the BEFORE UPDATE trigger rewrote the status back while the non-status
    // columns were still written — so updateMany reports count 1.
    stage(OPEN, {
      ...OPEN,
      status: "SETTLEMENT_HOLD",
      recoveryStripeSessionId: SESSION_ID,
      recoveryReason: RECOVERY_REASON,
    })

    await runApply()

    expect(rereads()).toBe(1)
    expect(logs.join("\n")).not.toContain('"written": true')
    expect(errors.join("\n")).toContain("SETTLEMENT_HOLD")
    expect(process.exitCode).toBe(1)
    // No restoration: exactly one write, and it never rewrites the prior status.
    expect(mockUpdateMany).toHaveBeenCalledTimes(1)
    expect(mockUpdateMany.mock.calls.map((call) => call[0].data.status)).toEqual(["PAID_RECOVERY_REQUIRED"])
  })

  it("refuses without re-reading when the guarded update matched no row", async () => {
    stage(OPEN, RECOVERED)
    mockUpdateMany.mockResolvedValue({ count: 0 })

    await runApply()

    expect(rereads()).toBe(0)
    expect(errors.join("\n")).toContain("OTOrder changed before recovery persistence")
    expect(logs.join("\n")).not.toContain('"written": true')
    expect(process.exitCode).toBe(1)
  })

  it("refuses when the persisted row carries a different recovery session", async () => {
    stage(OPEN, { ...RECOVERED, recoveryStripeSessionId: "cs_live_someone_else" })

    await runApply()

    expect(logs.join("\n")).not.toContain('"written": true')
    expect(errors.length).toBe(1)
    expect(process.exitCode).toBe(1)
  })

  it("reports success from the persisted row once recovery actually landed", async () => {
    stage(OPEN, RECOVERED)

    await runApply()

    expect(errors).toEqual([])
    expect(process.exitCode).toBeUndefined()
    expect(rereads()).toBe(1)
    expect(JSON.parse(logs[logs.length - 1])).toMatchObject({
      written: true,
      id: "ord_open",
      status: "PAID_RECOVERY_REQUIRED",
      recoveryStripeSessionId: SESSION_ID,
      recoveryReason: RECOVERY_REASON,
    })
  })
})
