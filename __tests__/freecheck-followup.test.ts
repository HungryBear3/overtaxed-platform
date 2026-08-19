import * as templates from "@/lib/email/templates"
import { shouldSendFreeCheckFollowup } from "@/lib/email/templates"

/**
 * The free-check follow-up email is withdrawn.
 *
 * This suite previously pinned the behaviour that made it unsafe: that a
 * $100 savings figure was enough to send, and that the message led with
 * "$1,200/year in potential savings" over a "Start Your Appeal" button. Those
 * expectations are not relaxed here — the thing they described is gone, and
 * what is asserted now is that it cannot come back by accident.
 */
describe("free-check follow-up withdrawal", () => {
  it("exports no template that can compose the message", () => {
    expect((templates as Record<string, unknown>).freeCheckFollowupTemplate).toBeUndefined()
  })

  it("refuses to send regardless of savings or step", () => {
    for (const savings of [null, undefined, 0, 99, 100, 1200, 100_000]) {
      for (const step of [0, 1, 2]) {
        expect(shouldSendFreeCheckFollowup(savings, step)).toBe(false)
      }
    }
  })

  it("no longer applies a savings threshold, so no figure unlocks a send", () => {
    // The old gate was `savings >= 100 && step === 0`. If any threshold
    // survived, one of these would differ from the others.
    expect(shouldSendFreeCheckFollowup(99, 0)).toBe(shouldSendFreeCheckFollowup(1200, 0))
  })

  it("carries no savings, overpayment, or merits copy in the module source", () => {
    // Guards the module against a template being reintroduced beside the gate.
    // Comments explaining the withdrawal are stripped before asserting.
    const fs = require("node:fs") as typeof import("node:fs")
    const src = fs
      .readFileSync("lib/email/templates.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")

    expect(src).not.toMatch(/potential savings/i)
    expect(src).not.toMatch(/over-assessed/i)
    expect(src).not.toMatch(/overpaying/i)
    expect(src).not.toMatch(/MEANINGFUL_SAVINGS_THRESHOLD/)
    expect(src).not.toMatch(/Start Your Appeal/i)
  })
})
