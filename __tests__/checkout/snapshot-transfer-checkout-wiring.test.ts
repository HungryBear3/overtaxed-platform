// Source-structure wiring only (same idiom as neutral-checkout-attempt-wiring):
// this does NOT execute the checkout handler. Native binding behavior is proven
// in __tests__/commerce/snapshot-checkout-transfer-native.test.ts.
import fs from "node:fs"; import path from "node:path"
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8")

test("checkout admits a transferred free result from its snapshot; evidence-immutable reservation precedes binding, binding precedes Stripe", () => {
  const source = read("app/api/checkout/session/route.ts")
  const claim = source.indexOf("productionSnapshotTransferAuthority().readClaim(req)")
  expect(claim).toBeGreaterThan(-1)
  // Transfer present: snapshot loader, never the county loader; rejection returns before order creation.
  expect(source).toMatch(/transfer\.status === "VALID" \? await loadNeutralCheckoutFromTransfer\(transfer\.claim\) : await loadNeutralCheckoutOfficialProperty\(snapshot\.pin\)/)
  expect(source.indexOf("SNAPSHOT_TRANSFER_REJECTED")).toBeGreaterThan(source.indexOf("export async function POST("))
  expect(source.indexOf("SNAPSHOT_TRANSFER_REJECTED")).toBeLessThan(source.indexOf("prisma.oTOrder.upsert("))
  const bind = source.indexOf("prepareNeutralCheckoutAdmission({ orderId: order.id")
  expect(bind).toBeGreaterThan(-1)
  const repository = read('lib/fulfillment-runtime/neutral-report-repository.ts')
  const operation = repository.slice(repository.indexOf('export async function prepareNeutralCheckoutAdmissionOrder('), repository.indexOf('export async function reserveNeutralCheckoutOrder('))
  expect(operation.indexOf('reserveNeutralCheckoutOrder(input, { db: tx })')).toBeLessThan(operation.indexOf('await bind()'))
  expect(operation).toContain('if (!reserved.ok) throw new AdmissionRollback(reserved.blocker)')
  expect(operation).toContain('if (!bound.ok) throw new AdmissionRollback(bound.blocker)')
  const transferred = source.slice(source.indexOf('if (snapshotTransferClaim) {',source.indexOf('orderId = order.id')),source.indexOf('} else try {',source.indexOf('orderId = order.id')))
  expect(transferred).not.toMatch(/updateMany|abandonNeutralCheckout/)
  expect(transferred).toContain('NEUTRAL_EVIDENCE_CONFLICT')
  expect(bind).toBeLessThan(source.indexOf("stripe.checkout.sessions.create("))
  expect(source).not.toMatch(/req\.json\(\)[^\n]*snapshotId|input\.snapshotId|body\.snapshotId/)
})

test("mounted free transfer route uses production authorities only", () => {
  const route = read("app/api/free-check/transfer/route.ts")
  expect(route).toContain("productionFreeResultAccess()")
  expect(route).toContain("productionSnapshotTransferAuthority()")
  expect(route).toContain("createPostgresAnalysisStore()")
})
