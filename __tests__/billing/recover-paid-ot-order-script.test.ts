import { readFileSync } from "node:fs"
import { join } from "node:path"

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
