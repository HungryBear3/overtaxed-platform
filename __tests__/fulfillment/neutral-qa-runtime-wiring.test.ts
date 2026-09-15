import fs from "node:fs"
import path from "node:path"

const read = (file:string) => fs.readFileSync(path.join(process.cwd(),file),"utf8")

describe("neutral QA runtime SQL/concurrency shape",()=>{
  const qa=read("lib/fulfillment-runtime/neutral-qa-store.ts")
  const promotion=read("lib/fulfillment-runtime/neutral-customer-promotion.ts")

  it("serializes the reviewer/week cap and derives elapsed time from the DB clock",()=>{
    expect(qa).toContain("neutral-qa-week:")
    expect(qa).toContain("pg_advisory_xact_lock")
    expect(qa).toContain("clock_timestamp()-")
    expect(qa).toContain("HARD_STOP_EXCEEDED")
    expect(qa).not.toContain("minutes_spent\"=${input.minutesSpent}")
    expect(qa).toContain('AND "order_id"<>${input.orderId}')
    expect(qa).toContain('ON CONFLICT ("reservation_id") DO NOTHING RETURNING "id"')
    expect(qa).toContain('blocker:"QA_OPEN_CONFLICT"')
  })

  it("CASes approval against current paid binding and records reversal holds",()=>{
    expect(qa).toContain('UPDATE "ot_neutral_qa_review" q SET "status"=\'APPROVED\'')
    expect(qa).toContain('NOT EXISTS (SELECT 1 FROM "ot_settlement_reversal"')
    expect(qa).toContain('"status"=\'HELD\'')
    expect(qa).toContain('"reason_code"=\'PAYMENT_REVERSED\'')
  })

  it("serializes by advisory lock and locks only the neutral-owned reservation",()=>{
    expect(promotion).toContain("neutral-promotion:")
    expect(promotion).toContain("pg_advisory_xact_lock")
    const reservation=promotion.indexOf('FROM "ot_neutral_report_reservation" WHERE "order_id"=${orderId} FOR UPDATE')
    expect(reservation).toBeGreaterThan(-1)
    expect(promotion).not.toMatch(/FROM "ot_order"[^`]*FOR UPDATE/)
    expect(promotion).not.toMatch(/FROM "ot_fulfillment"[^`]*FOR UPDATE/)
    expect(promotion).not.toContain("FOR UPDATE OF r,o,q")
  })

  it("keeps reviewed-bundle and promoted-customer identities separate and binds the order",()=>{
    expect(promotion).toContain('"customer_artifact_sha256"=${sha256}')
    expect(promotion).toContain('"artifact_sha256"=${r!.bundleSha256}')
    expect(promotion).toContain('"order_id"=${r!.orderId}')
  })

  it("quarantines a confirmed object when post-write authority fails",()=>{
    expect(promotion).toContain('"status"=\'QUARANTINED\'')
    expect(promotion).toContain('return quarantine(authority.blocker)')
    expect(promotion).toContain('changed===1?blocker:"QUARANTINE_CONFLICT"')
  })
  it("CASes attempt reconciliation and promotion without overwriting unknown/quarantined state",()=>{
    expect(promotion).toContain("'READ_CONFIRMED'")
    expect(promotion).toContain("AND \"status\"='WRITE_UNKNOWN'")
    expect(promotion).toContain("AND \"status\" IN ('WRITE_CONFIRMED','READ_CONFIRMED')")
  })
  it("checks complete identity before adopting an existing artifact",()=>{
    for(const field of ["byteSize","storageLocator","generatorVersion","templateVersion","sourceOrderId","propertyBindingFingerprint"])expect(promotion).toContain(field)
  })
})
