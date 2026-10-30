/** @jest-environment node */
// G1 NATIVE RED (ot-g1-producer-20261027). TEST-ONLY. No application file is changed by this suite.
//
// Claim under test (GAP-LEDGER G1): a LEGITIMATE zero-total (100% allowlisted discount) T2 order,
// settled through the REAL signed webhook and the REAL bindZeroTotalSettlement ledger, can never
// enter production generation authority, because the REAL `authority()` predicate in
// lib/fulfillment-runtime/neutral-generation-store.ts and the REAL resolveNeutralOrderAuthority in
// lib/fulfillment-runtime/neutral-order-authority.ts both require settledAmountCents=6900 AND
// amountPaid=69, while trustedPaymentAuthority's zero-total branch requires settledAmountCents=0.
//
// Executed for real, on the owned native PostgreSQL (unix socket only, schema = every
// repo/prisma/migrations/*/migration.sql, unchanged):
//  - app/api/checkout/session/route.ts POST (fresh CHECKOUT_PENDING -> CHECKOUT_CREATED, real
//    neutral reservation, real promotion binding in "checkoutDiscountPromotionCodeId")
//  - app/api/billing/webhook/route.ts POST with a REAL Stripe HMAC signature verified by the REAL
//    stripe-node constructEvent (offline; secret is a synthetic local fixture)
//  - REAL bindZeroTotalSettlement / bindPayment / recordReversal (called by the webhook, and
//    directly for binder refusals)
//  - REAL enqueueAndScheduleNeutralReportProduction -> REAL prismaNeutralGenerationStore.ensure
//  - REAL prismaNeutralGenerationStore.ensure and REAL resolveNeutralOrderAuthority called directly
//  The NODE_ENV=test shortcut in neutral-report-producer.ts is NOT on any path of this suite:
//  produceNeutralReport is never called.
//
// Declared seams (nothing else is replaced):
//  S1 "stripe" package: provider responses are synthetic local fixtures (no network). prices.retrieve,
//     promotionCodes.list/retrieve, checkout.sessions.create/retrieve/expire/listLineItems.
//     `webhooks` is the REAL stripe-node Webhooks object (real HMAC verify).
//  S2 @/lib/db and @/lib/fulfillment-runtime/neutral-db: connection construction only. App prisma is
//     the cluster superuser over the socket (same as the accepted predecessor native suites). Neutral
//     prisma is `postgres` during checkout setup (predecessor seam) and the REAL least-privilege role
//     `ot_neutral_runtime` for every webhook / ensure / resolve call (production grant topology).
//  S3 next/server `after`: callbacks are CAPTURED, never run (the generation worker / content
//     producer is out of scope for G1; G3/G4 are not exercised).
//  S4 @/lib/fulfillment-runtime/neutral-generation-scheduling: PASS-THROUGH recorder around the real
//     enqueueAndScheduleNeutralReportProduction (records the outcome the webhook ignores).
//  S5 @/lib/email/send: counting stub, no transport (GAP-LEDGER G2). @/lib/packet/generate-and-deliver:
//     inert (invoice branch only; never reached on the OT tier path).
//  S6 Checkout upstream (verbatim from __tests__/checkout/localqual-completion-nontransfer-native.test.ts):
//     cook-county lookup, deadline authority, preview-gate, rate-limit, and
//     neutral-raw-gateway.readNeutralOfficialBytesRuntime returning evidence produced in beforeAll by the
//     REAL gateway over an in-process synthetic county fetch. global.fetch throws afterwards.
//
// Missing native env is a HARD FAILURE (no describe.skip).
import { Pool } from "pg"
import { Prisma } from "@prisma/client"
import { randomBytes, randomUUID } from "node:crypto"

jest.mock("server-only", () => ({}), { virtual: true })
// Z5 only (F1): in-memory private object store for the neutral bundle (declared synthetic storage seam).
const mockBlobs = new Map<string, Buffer>()
jest.mock("@vercel/blob", () => ({
  put: async (pathname: string, bytes: Buffer) => { if (mockBlobs.has(pathname)) throw new Error("synthetic blob exists"); mockBlobs.set(pathname, Buffer.from(bytes)); return { pathname } },
  get: async (pathname: string) => { const b = mockBlobs.get(pathname); return b ? { statusCode: 200, blob: { pathname }, stream: new Blob([new Uint8Array(b)]).stream() } : null },
}))

const mockProvider = {
  creates: [] as Array<{ params: any; options: any }>,
  n: 0,
  lineItems: new Map<string, any>(),
  promotion: null as any,
  listCalls: [] as any[],
  retrieveCalls: [] as any[],
}
jest.mock("stripe", () => {
  const A = jest.requireActual("stripe")
  const ActualStripe = A.default ?? A
  const offline = new ActualStripe("sk_test_g1_offline_never_sent")
  const Stripe = jest.fn().mockImplementation(() => ({
    webhooks: offline.webhooks,
    checkout: { sessions: {
      create: async (params: any, options: any) => {
        mockProvider.creates.push({ params, options })
        mockProvider.n += 1
        return { id: `cs_test_g1_${mockProvider.n}_${jest.requireActual("node:crypto").randomBytes(8).toString("hex")}`, url: `https://checkout.stripe.test/g1/${mockProvider.n}`, status: "open", expires_at: Math.floor(Date.now() / 1000) + 3600 }
      },
      retrieve: async (id: string) => ({ id, status: "open", url: "https://checkout.stripe.test/r/" + id, expires_at: Math.floor(Date.now() / 1000) + 3600 }),
      expire: async (id: string) => ({ id, status: "expired" }),
      listLineItems: async (id: string) => {
        const li = mockProvider.lineItems.get(id)
        if (!li) throw new Error("G1_FIXTURE_NO_LINE_ITEMS " + id)
        return li
      },
    } },
    prices: { retrieve: async (id: string) => ({ id, active: true, type: "one_time", unit_amount: 6900, currency: "usd", product: "prod_t2" }) },
    promotionCodes: {
      list: async (q: any) => { mockProvider.listCalls.push(q); const p = mockProvider.promotion; return { data: p && q?.code === p.code ? [p] : [] } },
      retrieve: async (id: string, o: any) => { mockProvider.retrieveCalls.push({ id, o }); const p = mockProvider.promotion; if (!p || p.id !== id) throw new Error("G1_FIXTURE_NO_PROMOTION " + id); return p },
    },
    charges: { retrieve: async () => { throw new Error("G1_FIXTURE_UNEXPECTED_CHARGE_RETRIEVE") } },
  }))
  return { __esModule: true, default: Stripe }
})
jest.mock("@/lib/marketing/preview-gate", () => ({ ...jest.requireActual("@/lib/marketing/preview-gate"), hostFromRequest: () => "www.overtaxed-il.com", isPreviewStubEnabled: () => false, marketingGateReason: () => "test", previewNoopResponseBody: () => ({}) }))
jest.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ allowed: true }), getClientIdentifier: () => "g1-native-client" }))
const PIN = "14000000000088"
jest.mock("@/lib/cook-county", () => ({
  searchPropertiesByAddress: async () => ({ success: true, data: [{ pin: "14000000000088", property_address: "1 TEST ST", property_city: "CHICAGO", township_name: "Jefferson" }] }),
  getPropertyByPIN: async () => ({ success: true, data: { pin: "14000000000088", address: "1 TEST ST", city: "CHICAGO", zipCode: "60618", township: "Jefferson" } }),
  normalizePIN: (v: string) => v.replace(/\D/g, ""),
}))
const mockDeadlines: any = { schemaVersion: 1, synthetic: true, sources: {}, townships: {} }
jest.mock("@/data/deadlines/cook-county.json", () => mockDeadlines)
jest.mock("@/lib/deadlines/commerce-deadline-authority", () => ({
  projectCommerceDeadline: async ({ township, at }: { township: unknown; at: Date }) => {
    const { evaluateOfficialDeadlineState, projectDeadline } = jest.requireActual("@/lib/deadlines/official-source-state")
    return projectDeadline(evaluateOfficialDeadlineState({ snapshot: mockDeadlines, township, stage: "assessor", evaluatedAt: at.toISOString() }), at.toISOString())
  },
}))
const mockGateway = { calls: [] as string[], evidence: null as any, realProducerRead: false }
jest.mock("@/lib/fulfillment-runtime/neutral-raw-gateway", () => {
  const actual = jest.requireActual("@/lib/fulfillment-runtime/neutral-raw-gateway")
  return { ...actual, readNeutralOfficialBytesRuntime: async (input: { propertyPin: string; sharedSnapshotProtections?: boolean }) => {
    mockGateway.calls.push(input.propertyPin)
    // Z5 only: the paid producer's own read goes through the REAL gateway (synthetic county transport).
    if (mockGateway.realProducerRead && input.sharedSnapshotProtections !== true) return actual.readNeutralOfficialBytesRuntime(input)
    if (!mockGateway.evidence || input.propertyPin !== mockGateway.evidence.subject.pin || input.sharedSnapshotProtections !== true) throw new Error("UNEXPECTED_ACQUISITION")
    return { ok: true, evidence: mockGateway.evidence }
  } }
})
const mockAfter = { callbacks: [] as Array<() => Promise<void>> }
jest.mock("next/server", () => ({ ...jest.requireActual("next/server"), after: (cb: () => Promise<void>) => { mockAfter.callbacks.push(cb) } }))
type EnqueueOutcome = { orderId: string; kind: "returned" | "threw"; value?: any; error?: string }
const mockEnqueue = { outcomes: [] as EnqueueOutcome[] }
jest.mock("@/lib/fulfillment-runtime/neutral-generation-scheduling", () => {
  const actual = jest.requireActual("@/lib/fulfillment-runtime/neutral-generation-scheduling")
  return { ...actual, enqueueAndScheduleNeutralReportProduction: async (orderId: string, deps: any) => {
    try { const value = await actual.enqueueAndScheduleNeutralReportProduction(orderId, deps); mockEnqueue.outcomes.push({ orderId, kind: "returned", value }); return value }
    catch (e: any) { mockEnqueue.outcomes.push({ orderId, kind: "threw", error: String(e?.message ?? e) }); throw e }
  } }
})
const mockEmail = { alerts: 0, confirmations: 0 }
jest.mock("@/lib/email/send", () => ({
  sendNewOrderAlert: async () => { mockEmail.alerts += 1; return true },
  sendOrderConfirmation: async () => { mockEmail.confirmations += 1; return true },
}))
jest.mock("@/lib/packet/generate-and-deliver", () => ({ generatePacketForInvoice: async () => { throw new Error("G1_UNEXPECTED_INVOICE_PATH") } }))

const mockClients: { app?: any; neutral?: any } = {}
const mockNeutral = { role: "postgres" as "postgres" | "ot_neutral_runtime" }
function mockPrismaAs(user: string, max: number) {
  const { PrismaClient } = jest.requireActual("@prisma/client")
  const { PrismaPg } = jest.requireActual("@prisma/adapter-pg")
  const { Pool: P } = jest.requireActual("pg")
  const pool = new P({ host: process.env.CHECKOUT_NATIVE_SOCKET_DIR, port: Number(process.env.CHECKOUT_NATIVE_PORT), database: process.env.CHECKOUT_NATIVE_DB, user, max })
  pool.on("error", () => {})
  return new PrismaClient({ adapter: new PrismaPg(pool) })
}
function mockAppPrisma() { if (!mockClients.app) mockClients.app = mockPrismaAs("postgres", 6); return mockClients.app }
function mockNeutralPrisma() {
  if (mockNeutral.role === "postgres") return mockAppPrisma()
  if (!mockClients.neutral) mockClients.neutral = mockPrismaAs("ot_neutral_runtime", 3)
  return mockClients.neutral
}
jest.mock("@/lib/db", () => ({ get prisma() { return mockAppPrisma() } }))
jest.mock("@/lib/fulfillment-runtime/neutral-db", () => ({ neutralPrisma: () => mockNeutralPrisma(), disconnectNeutralPrisma: async () => {} }))

const env = process.env
const REQUIRED_ENV = ["SNAPSHOT_TEST_WRITER_URL", "SNAPSHOT_TEST_READER_URL", "SNAPSHOT_TEST_BINDER_URL", "SNAPSHOT_TEST_ADMIN_URL", "CHECKOUT_NATIVE_DB", "CHECKOUT_NATIVE_SOCKET_DIR", "CHECKOUT_NATIVE_PORT"] as const
const SECRET = "g1-native-checkout-secret-0123456789abcdef"
const WHSEC = "whsec_g1_native_synthetic_local_fixture_only"
const PROMO_ID = "promo_g1_full_report"
const PROMO_CODE = "G1FREEREPORT"
const COUPON_ID = "coupon_g1_full"
const countyDay = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + days * 864e5))
const hex = () => randomBytes(4).toString("hex")

function armWindow() {
  const url = "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines"
  const source = { authority: "cook_county_assessor", sourceUrl: url, retrievedAt: new Date(Date.now() - 5000).toISOString(), sourceUpdatedAt: null, contentSha256: "e".repeat(64), httpStatus: 200, finalUrl: url, parseStatus: "ok", parserVersion: "1.0.0" }
  mockDeadlines.synthetic = false
  mockDeadlines.sources = { assessor: source, bor: source }
  mockDeadlines.townships = { jefferson: { townshipName: "Jefferson", stages: { assessor: { noticeDate: null, openDate: countyDay(-10), lastFileDate: countyDay(20) } } } }
}

/** Official calendar transport fixture (in-process): every township open countyDay(-10)..countyDay(20), as admitted. */
function officialCalendarHtml() {
  const { ASSESSOR_CONTEXT } = jest.requireActual("@/lib/deadlines/assessor-calendar-context")
  const { TOWNSHIPS } = jest.requireActual("@/lib/townships")
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}/${d.slice(0, 4)}`
  const open = countyDay(-10), close = countyDay(20)
  const fld = (label: string, key: string, d: string) => `<div><span class="label-a">${label}</span><div class="field--name-field-${key}"><time datetime="${d}T12:00:00Z">${md(d)}</time></div></div>`
  const card = (name: string) => `<div class="views-row"><div class="row On title"><div class="views-field-title">${name}</div><div class="open-appeal">Open For Appeals Until ${md(close)}</div></div><div class="row copy">${fld("Reassessment Notice Date", "reassessment-notice-date", open)}${fld("Last File Date", "last-file-date", close)}</div></div>`
  const groups = ["South &amp; West Suburban Cook County", "North Suburbs &amp; City of Chicago"]
  return `<!doctype html><html><body><main class="region-content"><h1 class="page-title">Assessment &amp; Appeal Calendar</h1>${groups.map((g, i) => `<section class="paragraph--type--township-set"><h2 class="field--name-field-title">2026 Assessment Calendar: ${g}</h2><div class="field--name-field-long-text">${ASSESSOR_CONTEXT[i]}</div><div class="field--name-field-assessment"><div class="paragraph--type--assessment-calendar-set"><div class="field--name-field-set">${TOWNSHIPS.filter((t: any) => (t.district === "south-west-suburbs") === (i === 0)).map((t: any) => card(t.name === "Lake View" ? "Lakeview" : t.name)).join("")}</div></div></div></section>`).join("")}</main></body></html>`
}

// Synthetic county-shaped official records (verbatim from the predecessor suite). In-process only.
const pins = [PIN, "14000000000089", "14000000000090", "14000000000091", "14000000000092"]
const cls = ["203", "203", "203", "203", "204"], tot = [40000, 20000, 30000, 90000, 50000], sqft = ["1000", "1000", "1000", "4000", "1000"]
const fields: Record<string, string> = { "pabr-t5kh": "pin,year,class,township_code,township_name,nbhd_code", "uzyt-m557": "pin,year,class,township_code,nbhd,mailed_tot,mailed_land,mailed_bldg", "x54s-btds": "pin,year,class,township_code,pin_num_cards,pin_is_multiland,pin_num_landlines,tieback_key_pin,tieback_proration_rate,card_proration_rate,char_bldg_sf,char_yrblt,char_type_resd", "3723-97qp": "pin,year,prop_address_full,prop_address_city_name,prop_address_state,prop_address_zipcode_1" }
function row(id: string, pin: string): Record<string, unknown> {
  const i = pins.indexOf(pin)
  if (id === "pabr-t5kh") return { pin, year: "2026", class: cls[i], township_code: "70", township_name: "Jefferson", nbhd_code: "70120" }
  if (id === "uzyt-m557") return { pin, year: "2026", class: cls[i], township_code: "70", nbhd: "70120", mailed_tot: String(tot[i]), mailed_land: "10000", mailed_bldg: String(tot[i] - 10000) }
  if (id === "x54s-btds") return { pin, year: "2026", class: cls[i], township_code: "70", char_bldg_sf: sqft[i], char_yrblt: "1950", char_type_resd: "1", pin_num_cards: "1", pin_is_multiland: "0", pin_num_landlines: "1", tieback_key_pin: null, tieback_proration_rate: null, card_proration_rate: "1" }
  if (id === "3723-97qp") return { pin, year: "2026", prop_address_full: `${i + 1} SYNTHETIC ST`, prop_address_city_name: "CHICAGO", prop_address_state: "IL", prop_address_zipcode_1: "60601" }
  throw Error("unexpected dataset " + id)
}
async function syntheticCountyFetch(url: string) {
  const u = new URL(url), id = u.pathname.split("/").pop()!.replace(".json", ""), sel = u.searchParams.get("$select") ?? "", where = u.searchParams.get("$where") ?? ""
  let data: unknown
  if (u.pathname.includes("/api/views/")) data = { id, provenance: "official", rowsUpdatedAt: 1, viewLastModified: 1, tableId: 1, columns: fields[id].split(",").map(fieldName => ({ fieldName, dataTypeName: "text" })) }
  else if (sel === "count(*) AS n") data = [{ n: String(pins.length) }]
  else if (sel === "year") data = [{ year: "2026" }]
  else {
    const single = /pin='(\d{14})'/.exec(where), listed = /pin in ?\(([^)]*)\)/.exec(where)
    const chosen = single ? [single[1]] : listed ? listed[1].split(",").map(s => s.replace(/'/g, "").trim()) : pins
    data = Number(u.searchParams.get("$offset") ?? "0") > 0 ? [] : chosen.map(pin => { const r = row(id, pin); return Object.fromEntries(sel.split(",").filter(k => k in r).map(k => [k, r[k]])) })
  }
  const r = new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } })
  Object.defineProperty(r, "url", { value: url })
  return r
}

function fullDiscountPromotion() {
  return {
    id: PROMO_ID, object: "promotion_code", active: true, code: PROMO_CODE,
    promotion: { type: "coupon", coupon: { id: COUPON_ID, object: "coupon", valid: true, percent_off: 100, amount_off: null, currency: null, applies_to: { products: ["prod_t2"] } } },
  }
}

type Checkout = { label: string; key: string; email: string; order: any; create: { params: any; options: any }; reservation: any[] }

describe("G1 native: legitimate zero-total settlement vs production generation authority (REAL ensure + resolveNeutralOrderAuthority)", () => {
  const pools: Pool[] = []
  let admin: Pool
  let CHECKOUT: (req: any) => Promise<Response>
  let WEBHOOK: (req: any) => Promise<Response>
  let store: { ensure(orderId: string): Promise<{ workId: string } | null> }
  let resolve: (orderId: string) => Promise<any>
  let bindZeroTotalSettlement: (tx: any, s: any) => Promise<void>
  let trustedPaymentAuthority: (alias: "o", neutral: boolean) => Prisma.Sql
  let policyVersion = "", reservationKey: (orderId: string) => string
  let offlineWebhooks: any
  const trace: Record<string, unknown> = {}
  // Shared state, filled by the controls / Z0 and consumed by later cases.
  const S: { P?: Checkout; Pwork?: string; Pevent?: string; Ppi?: string; Pauth?: any; Z?: Checkout; Zevent?: string } = {}

  beforeAll(async () => {
    const missing = REQUIRED_ENV.filter(k => !env[k])
    if (missing.length) throw new Error("G1_NATIVE_ENV_MISSING " + missing.join(","))
    Object.assign(process.env, {
      NEXTAUTH_SECRET: SECRET, STRIPE_SECRET_KEY: "sk_test_g1_native", STRIPE_PRICE_T2_DIY_PRO: "price_t2", STRIPE_PRICE_T3_DFY: "price_t3",
      STRIPE_WEBHOOK_SECRET: WHSEC,
      OT_CHECKOUT_GATE_SECRET: "g1-native-gate-secret-at-least-32-characters-long", OT_NEUTRAL_REPORT_CHECKOUT_ENABLED: "true",
      OT_NEUTRAL_REPORT_PRODUCTION_ENABLED: "true", OT_FULL_DISCOUNT_PROMOTION_CODE_IDS: PROMO_ID,
      OT_FACTUAL_DATABASE_URL: env.SNAPSHOT_TEST_WRITER_URL, OT_PAID_SNAPSHOT_READER_DATABASE_URL: env.SNAPSHOT_TEST_READER_URL,
      OT_PAID_SNAPSHOT_BINDER_DATABASE_URL: env.SNAPSHOT_TEST_BINDER_URL, OT_FACTUAL_DATABASE_SSL: "disable",
    })
    for (const k of ["OT_NEUTRAL_TEST_RUNTIME_URL", "RESEND_API_KEY", "NEXT_PUBLIC_GA_MEASUREMENT_ID", "GA4_API_SECRET", "OT_NEUTRAL_REPORT_ACTIVE"]) delete process.env[k]
    admin = new Pool({ connectionString: env.SNAPSHOT_TEST_ADMIN_URL, max: 2 }); admin.on("error", () => {}); pools.push(admin)

    // Schema/topology preconditions (migrations applied unchanged; the least-privilege role logs in).
    const schema = (await admin.query(`SELECT to_regclass('public.ot_zero_total_settlement') IS NOT NULL AS ledger, to_regclass('public.ot_neutral_runtime_zero_total_settlement') IS NOT NULL AS view, to_regclass('public.ot_neutral_generation_work') IS NOT NULL AS work, current_setting('server_version') AS version, (SELECT rolcanlogin FROM pg_roles WHERE rolname='ot_neutral_runtime') AS neutral_login`)).rows[0]
    trace.schema = schema
    if (!schema.ledger || !schema.view || !schema.work || schema.neutral_login !== true) throw new Error("G1_NATIVE_SCHEMA_PRECONDITION " + JSON.stringify(schema))
    // Capacity preconditions (no mutation of foreign rows): 6 live checkouts and 2 paid cohort slots needed.
    const cap = (await admin.query(`SELECT count(*) FILTER (WHERE status<>'ABANDONED')::int AS live, count(*) FILTER (WHERE paid_cohort_position IS NOT NULL)::int AS paid FROM ot_neutral_report_reservation`)).rows[0]
    trace.capacityAtStart = cap
    if (cap.live > 4 || cap.paid > 8) throw new Error("G1_NATIVE_CAPACITY_PRECONDITION use a fresh cluster " + JSON.stringify(cap))

    const realFetch = (global as any).fetch
    ;(global as any).fetch = syntheticCountyFetch
    try {
      const real = jest.requireActual("@/lib/fulfillment-runtime/neutral-raw-gateway")
      const raw = await real.readNeutralOfficialBytesRuntime({ propertyPin: PIN, sharedSnapshotProtections: true })
      if (!raw.ok) throw new Error("synthetic evidence refused: " + raw.blocker)
      mockGateway.evidence = raw.evidence
    } finally { (global as any).fetch = async () => { throw new Error("NETWORK_FORBIDDEN_IN_TEST") }; void realFetch }

    const A = jest.requireActual("stripe")
    offlineWebhooks = new (A.default ?? A)("sk_test_g1_offline_never_sent").webhooks
    ;({ POST: CHECKOUT } = await import("@/app/api/checkout/session/route") as any)
    ;({ POST: WEBHOOK } = await import("@/app/api/billing/webhook/route") as any)
    ;({ prismaNeutralGenerationStore: store } = await import("@/lib/fulfillment-runtime/neutral-generation-store") as any)
    ;({ resolveNeutralOrderAuthority: resolve } = await import("@/lib/fulfillment-runtime/neutral-order-authority") as any)
    ;({ bindZeroTotalSettlement } = await import("@/lib/checkout/ot-reversal") as any)
    ;({ trustedPaymentAuthority } = await import("@/lib/fulfillment-runtime/payment-authority") as any)
    const policy = await import("@/lib/commerce/neutral-report-policy")
    policyVersion = policy.NEUTRAL_REPORT_COMMERCE_POLICY.version
    reservationKey = policy.neutralOrderReservationKey
    mockProvider.promotion = fullDiscountPromotion()
  }, 120000)

  afterAll(async () => {
    trace.enqueue = mockEnqueue.outcomes
    trace.afterCallbacksCaptured = mockAfter.callbacks.length
    trace.emailSeam = { ...mockEmail }
    console.log("G1-TRACE " + JSON.stringify(trace))
    await mockClients.neutral?.$disconnect().catch(() => {})
    await mockClients.app?.$disconnect().catch(() => {})
    await Promise.all(pools.map(p => p.end().catch(() => {})))
  })
  beforeEach(() => { armWindow() })

  // ---------- helpers (all reads via the admin connection; writes only via real routes/functions) ----------
  const orderByKey = async (key: string) => (await admin.query(`SELECT id, status::text AS status, "stripeSessionId" AS sid, tier, "propertyPin" AS pin,
      "checkoutPriceId" AS "priceId", "checkoutProductId" AS "productId", "checkoutAmountCents" AS "checkoutAmountCents", "checkoutCurrency" AS currency,
      "checkoutDiscountPromotionCodeId" AS promo, "settledAmountCents" AS "settledAmountCents", "settledCurrency" AS "settledCurrency",
      "amountPaid"::float8 AS "amountPaid", "recoveryReason" AS "recoveryReason", "eligibilitySnapshot"->>'policyVersion' AS policy
    FROM ot_order WHERE "checkoutKey"=$1`, [key])).rows[0]
  const reservations = async (orderId: string) => (await admin.query(`SELECT id, status::text AS status, policy_version AS policy, reservation_key AS "reservationKey", checkout_price_id AS "priceId", checkout_product_id AS "productId", paid_cohort_position AS "paidSlot" FROM ot_neutral_report_reservation WHERE order_id=$1`, [orderId])).rows
  const workRows = async (orderId: string) => (await admin.query(`SELECT id, reservation_id AS "reservationId", status::text AS status FROM ot_neutral_generation_work WHERE order_id=$1`, [orderId])).rows
  const ledger = async (orderId: string) => (await admin.query(`SELECT order_id AS "orderId", session_id AS "sessionId", event_id AS "eventId", promotion_code AS "promotionCode", coupon, subtotal_cents AS "subtotalCents", discount_cents AS "discountCents", currency FROM ot_zero_total_settlement WHERE order_id=$1`, [orderId])).rows
  const piBindings = async (orderId: string) => (await admin.query(`SELECT session_id AS "sessionId", payment_intent AS "paymentIntent" FROM ot_payment_binding WHERE order_id=$1`, [orderId])).rows
  const enqueueFor = (orderId: string) => mockEnqueue.outcomes.filter(o => o.orderId === orderId)
  /** Payment authority evaluated by the REAL trustedPaymentAuthority(…, neutral=true) as the REAL ot_neutral_runtime role. */
  async function neutralPaymentAuthority(orderId: string) {
    mockNeutral.role = "ot_neutral_runtime"
    const c = mockNeutralPrisma()
    const who = await c.$queryRaw(Prisma.sql`SELECT current_user::text AS u`) as Array<{ u: string }>
    expect(who[0].u).toBe("ot_neutral_runtime")
    const rows = await c.$queryRaw(Prisma.sql`SELECT o."id" FROM "ot_neutral_runtime_order" o WHERE o."id"=${orderId} AND ${trustedPaymentAuthority("o", true)}`) as Array<{ id: string }>
    return rows.length === 1
  }
  async function ensureAsNeutral(orderId: string) { mockNeutral.role = "ot_neutral_runtime"; return store.ensure(orderId) }
  async function resolveAsNeutral(orderId: string) { mockNeutral.role = "ot_neutral_runtime"; return resolve(orderId) }

  const body = (key: string, email: string, extra: Record<string, unknown>) => ({ tier: "T2", email, name: "Buyer Name", address: "1 Test St, Chicago IL 60618", propertyPin: PIN, checkoutKey: key, ...extra })
  const postCheckout = (b: Record<string, unknown>, cookie?: string) => CHECKOUT(new Request("https://www.overtaxed-il.com/api/checkout/session", { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(b) }) as any)

  /** REAL checkout route: fresh CHECKOUT_PENDING -> acknowledgment -> CHECKOUT_CREATED with a live RESERVED reservation. */
  async function checkout(label: string, promotionCode?: string, cookie?: string): Promise<Checkout> {
    mockNeutral.role = "postgres"
    const key = randomUUID(), email = `g1-${label.toLowerCase()}-${hex()}@example.com`
    const promo = promotionCode ? { promotionCode } : {}
    expect(await orderByKey(key)).toBeUndefined() // fresh: no durable order for this checkoutKey yet
    const first = await (await postCheckout(body(key, email, promo), cookie)).json()
    expect(first.code).toBe("T2_ACKNOWLEDGMENT_REQUIRED")
    // The route may or may not persist the CHECKOUT_PENDING row at the acknowledgment step; either way
    // it must be fresh (no session) before the acknowledged request claims it.
    const pending = await orderByKey(key)
    if (pending) expect({ status: pending.status, sid: pending.sid }).toEqual({ status: "CHECKOUT_PENDING", sid: null })
    const r = await postCheckout(body(key, email, { ...promo, analysisAcknowledged: true, acknowledgmentToken: first.acknowledgmentToken }), cookie)
    const j = await r.json()
    expect({ status: r.status, url: typeof j.url, code: j.code ?? null }).toEqual({ status: 200, url: "string", code: null })
    const order = await orderByKey(key)
    expect(order).toMatchObject({ status: "CHECKOUT_CREATED", tier: "T2", pin: PIN, priceId: "price_t2", productId: "prod_t2", checkoutAmountCents: 6900, currency: "usd", policy: policyVersion })
    expect(order.sid).toMatch(/^cs_test_g1_/)
    const creates = mockProvider.creates.filter(c => c.params.metadata?.orderId === order.id)
    expect(creates).toHaveLength(1)
    const reservation = await reservations(order.id)
    expect(reservation.map(x => ({ status: x.status, policy: x.policy, key: x.reservationKey, priceId: x.priceId, productId: x.productId, slot: x.paidSlot })))
      .toEqual([{ status: "RESERVED", policy: policyVersion, key: reservationKey(order.id), priceId: "price_t2", productId: "prod_t2", slot: null }])
    trace["checkout-" + label] = { orderId: order.id, sid: order.sid, promo: order.promo, pendingAfterAck: pending?.status ?? null, discounts: creates[0].params.discounts ?? null }
    return { label, key, email, order, create: creates[0], reservation }
  }

  function paidSession(c: Checkout, pi: string) {
    return { id: c.order.sid, object: "checkout.session", mode: "payment", status: "complete", payment_status: "paid", payment_intent: pi,
      currency: "usd", amount_subtotal: 6900, amount_total: 6900, total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
      metadata: c.create.params.metadata, customer_details: { email: c.email, name: "Buyer Name" } }
  }
  function zeroSession(c: Checkout, over: Record<string, unknown> = {}) {
    return { id: c.order.sid, object: "checkout.session", mode: "payment", status: "complete", payment_status: "no_payment_required", payment_intent: null,
      currency: "usd", amount_subtotal: 6900, amount_total: 0, total_details: { amount_discount: 6900, amount_shipping: 0, amount_tax: 0 },
      metadata: c.create.params.metadata, customer_details: { email: c.email, name: "Buyer Name" }, ...over }
  }
  function armPaidLineItems(c: Checkout) {
    mockProvider.lineItems.set(c.order.sid, { data: [{ quantity: 1, amount_subtotal: 6900, amount_discount: 0, amount_total: 6900, currency: "usd",
      price: { id: "price_t2", unit_amount: 6900, currency: "usd", product: { id: "prod_t2" } }, discounts: [] }] })
  }
  /** Provider evidence derived from what the REAL checkout route sent to the provider for this session. */
  function armZeroLineItems(c: Checkout, promotionCode = c.create.params.discounts?.[0]?.promotion_code) {
    mockProvider.lineItems.set(c.order.sid, { data: [{ quantity: 1, amount_subtotal: 6900, amount_discount: 6900, amount_total: 0, currency: "usd",
      price: { id: "price_t2", unit_amount: 6900, currency: "usd", product: { id: "prod_t2" } },
      discounts: [{ amount: 6900, discount: { id: "di_g1_" + hex(), checkout_session: c.order.sid, promotion_code: promotionCode, source: { coupon: COUPON_ID, type: "coupon" } } }] }] })
  }
  /** REAL webhook POST, REAL HMAC signature verified by REAL stripe-node constructEvent. */
  async function deliver(eventId: string, type: string, object: Record<string, unknown>) {
    const payload = JSON.stringify({ id: eventId, object: "event", type, data: { object } })
    const sig = offlineWebhooks.generateTestHeaderString({ payload, secret: WHSEC })
    mockNeutral.role = "ot_neutral_runtime"
    const r = await WEBHOOK(new Request("https://www.overtaxed-il.com/api/billing/webhook", { method: "POST", headers: { "stripe-signature": sig, "content-type": "application/json" }, body: payload }) as any)
    return { status: r.status, json: await r.json() }
  }
  const anyBinderError = (p: Promise<unknown>) => expect(p).rejects.toThrow(/mismatch|Invalid OT zero-total/)

  // ---------------------------------------------------------------------------------------------------
  it("G0 harness: forged webhook signature is rejected by the REAL verifier (no settlement)", async () => {
    const payload = JSON.stringify({ id: "evt_g1_forged_" + hex(), object: "event", type: "checkout.session.completed", data: { object: {} } })
    const forged = offlineWebhooks.generateTestHeaderString({ payload, secret: "whsec_wrong" })
    const r = await WEBHOOK(new Request("https://www.overtaxed-il.com/api/billing/webhook", { method: "POST", headers: { "stripe-signature": forged }, body: payload }) as any)
    expect(r.status).toBe(400)
  })

  it("P1 CONTROL (must PASS): paid 6900 order via REAL webhook + bindPayment enters production authority", async () => {
    const P = await checkout("P")
    expect(P.order.promo).not.toBe(PROMO_ID) // product-defined "no promotion" binding, recorded in trace
    expect(P.create.params.discounts).toBeUndefined()
    const pi = "pi_g1_paid_" + hex(), eventId = "evt_g1_paid_" + hex()
    armPaidLineItems(P)
    const w = await deliver(eventId, "checkout.session.completed", paidSession(P, pi))
    expect(w.status).toBe(200)
    const order = await orderByKey(P.key)
    expect(order).toMatchObject({ status: "PAID", settledAmountCents: 6900, settledCurrency: "usd", amountPaid: 69 })
    expect(await piBindings(order.id)).toEqual([{ sessionId: order.sid, paymentIntent: pi }])
    expect(await ledger(order.id)).toEqual([])
    expect(await neutralPaymentAuthority(order.id)).toBe(true)
    const enq = enqueueFor(order.id)
    expect(enq).toEqual([{ orderId: order.id, kind: "returned", value: { outcome: "SCHEDULED", workId: expect.any(String) } }])
    const work = await workRows(order.id)
    expect(work).toEqual([{ id: enq[0].value.workId, reservationId: P.reservation[0].id, status: "PENDING" }])
    // Direct REAL ensure: idempotent, same work row.
    expect(await ensureAsNeutral(order.id)).toEqual({ workId: enq[0].value.workId })
    // Direct REAL resolveNeutralOrderAuthority: admitted to a paid cohort slot.
    const auth = await resolveAsNeutral(order.id)
    expect(auth).toMatchObject({ orderId: order.id, propertyPin: PIN, reservationId: P.reservation[0].id })
    for (const k of ["admissionSha256", "dataEvidenceSha256", "deadlineEvidenceSha256"]) expect(auth[k]).toMatch(/^[0-9a-f]{64}$/)
    const slot = (await reservations(order.id))[0].paidSlot
    expect(Number.isInteger(slot) && slot >= 1 && slot <= 10).toBe(true)
    Object.assign(S, { P: { ...P, order }, Pwork: enq[0].value.workId, Pevent: eventId, Ppi: pi, Pauth: auth })
    trace.P = { orderId: order.id, workId: S.Pwork, slot }
  }, 90000)

  it("P2 CONTROL (must PASS): paid replay (same event, new event) and repeated ensure/resolve are idempotent", async () => {
    if (!S.P) throw new Error("G1_DEPENDENCY P1 did not complete")
    const id = S.P.order.id
    const r1 = await deliver(S.Pevent!, "checkout.session.completed", paidSession(S.P, S.Ppi!))
    const r2 = await deliver("evt_g1_paid_redelivery_" + hex(), "checkout.session.completed", paidSession(S.P, S.Ppi!))
    expect([r1.status, r2.status]).toEqual([200, 200])
    expect(enqueueFor(id).map(o => o.value)).toEqual([1, 2, 3].map(() => ({ outcome: "SCHEDULED", workId: S.Pwork })))
    expect((await workRows(id)).map(w => w.id)).toEqual([S.Pwork])
    expect(await ensureAsNeutral(id)).toEqual({ workId: S.Pwork })
    const slotBefore = (await reservations(id))[0].paidSlot
    expect(await resolveAsNeutral(id)).toEqual(S.Pauth)
    expect((await reservations(id))[0].paidSlot).toBe(slotBefore)
    expect(await piBindings(id)).toHaveLength(1)
  }, 90000)

  it("Z0 PRECONDITION (must PASS): legitimate zero-total chain — REAL checkout promo binding -> REAL signed webhook -> REAL bindZeroTotalSettlement immutable ledger -> PAID at 0", async () => {
    const Z = await checkout("Z", PROMO_CODE)
    expect(Z.order.promo).toBe(PROMO_ID)
    expect(Z.create.params.discounts).toEqual([{ promotion_code: PROMO_ID }])
    expect(mockProvider.listCalls.some(q => q.code === PROMO_CODE)).toBe(true)
    const eventId = "evt_g1_zero_" + hex()
    armZeroLineItems(Z)
    const w = await deliver(eventId, "checkout.session.completed", zeroSession(Z))
    // G1 symptom on frozen code: the webhook acknowledges 200 regardless of the enqueue outcome.
    expect(w.status).toBe(200)
    const order = await orderByKey(Z.key)
    expect(order).toMatchObject({ status: "PAID", settledAmountCents: 0, settledCurrency: "usd", amountPaid: 0, checkoutAmountCents: 6900, promo: PROMO_ID, recoveryReason: null })
    expect(await ledger(order.id)).toEqual([{ orderId: order.id, sessionId: order.sid, eventId, promotionCode: PROMO_ID, coupon: COUPON_ID, subtotalCents: 6900, discountCents: 6900, currency: "usd" }])
    expect(mockProvider.retrieveCalls.some(c => c.id === PROMO_ID)).toBe(true)
    expect(await piBindings(order.id)).toEqual([]) // zero-total never writes the PI ledger
    // The REAL zero-total payment-authority branch ACCEPTS this order as the REAL neutral role.
    expect(await neutralPaymentAuthority(order.id)).toBe(true)
    expect((await reservations(order.id)).map(r => ({ status: r.status, slot: r.paidSlot }))).toEqual([{ status: "RESERVED", slot: null }])
    Object.assign(S, { Z: { ...Z, order }, Zevent: eventId })
    trace.Z = { orderId: order.id, sid: order.sid, settledAmountCents: order.settledAmountCents, amountPaid: order.amountPaid }
  }, 90000)

  it("Z1 G1 RED: the REAL webhook's enqueue of a legitimate zero-total order is SCHEDULED with one work row (frozen code: REFUSED, no row)", async () => {
    if (!S.Z) throw new Error("G1_DEPENDENCY Z0 did not complete")
    const id = S.Z.order.id
    trace.Z1 = { enqueue: enqueueFor(id), work: await workRows(id) }
    expect(enqueueFor(id)).toEqual([{ orderId: id, kind: "returned", value: { outcome: "SCHEDULED", workId: expect.any(String) } }])
    expect(await workRows(id)).toEqual([{ id: enqueueFor(id)[0].value?.workId, reservationId: S.Z.reservation[0].id, status: "PENDING" }])
  })

  it("Z2 G1 RED: direct REAL prismaNeutralGenerationStore.ensure admits the legitimate zero-total order (frozen code: null)", async () => {
    if (!S.Z) throw new Error("G1_DEPENDENCY Z0 did not complete")
    const id = S.Z.order.id
    const work = await ensureAsNeutral(id)
    trace.Z2 = { ensure: work }
    expect(work).toEqual({ workId: expect.any(String) })
    expect((await workRows(id)).map(w => ({ id: w.id, reservationId: w.reservationId }))).toEqual([{ id: work!.workId, reservationId: S.Z.reservation[0].id }])
  })

  it("Z3 G1 RED: direct REAL resolveNeutralOrderAuthority admits the legitimate zero-total order (frozen code: null)", async () => {
    if (!S.Z) throw new Error("G1_DEPENDENCY Z0 did not complete")
    const id = S.Z.order.id
    const auth = await resolveAsNeutral(id)
    trace.Z3 = { resolve: auth, reservation: await reservations(id) }
    expect(auth).toMatchObject({ orderId: id, propertyPin: PIN, reservationId: S.Z.reservation[0].id })
    for (const k of ["admissionSha256", "dataEvidenceSha256", "deadlineEvidenceSha256"]) expect(auth[k]).toMatch(/^[0-9a-f]{64}$/)
    const slot = (await reservations(id))[0].paidSlot
    expect(Number.isInteger(slot) && slot >= 1 && slot <= 10).toBe(true)
  })

  it("Z4 replay: ledger stays single and immutable (must PASS); replays converge on ONE work row and stable authority (G1 RED on frozen code)", async () => {
    if (!S.Z) throw new Error("G1_DEPENDENCY Z0 did not complete")
    const Z = S.Z, id = Z.order.id
    const before = await ledger(id)
    armZeroLineItems(Z)
    const r1 = await deliver(S.Zevent!, "checkout.session.completed", zeroSession(Z))
    const r2 = await deliver("evt_g1_zero_redelivery_" + hex(), "checkout.session.completed", zeroSession(Z))
    expect([r1.status, r2.status]).toEqual([200, 200])
    // Ledger idempotence through the REAL binder (passes on frozen code).
    expect(await ledger(id)).toEqual(before)
    expect(before[0]?.eventId).toBe(S.Zevent)
    expect((await orderByKey(Z.key))).toMatchObject({ status: "PAID", settledAmountCents: 0, amountPaid: 0 })
    // Production idempotence (RED on frozen code).
    const outcomes = enqueueFor(id).map(o => o.value)
    trace.Z4 = { outcomes, work: await workRows(id) }
    expect(outcomes.length).toBeGreaterThanOrEqual(3)
    const ids = new Set(outcomes.map(o => o?.workId))
    expect(outcomes.every(o => o?.outcome === "SCHEDULED")).toBe(true)
    expect(ids.size).toBe(1)
    expect((await workRows(id)).map(w => w.id)).toEqual([...ids])
    const a1 = await resolveAsNeutral(id), slot1 = (await reservations(id))[0].paidSlot
    const a2 = await resolveAsNeutral(id), slot2 = (await reservations(id))[0].paidSlot
    expect(a1).not.toBeNull()
    expect(a2).toEqual(a1)
    expect(slot2).toBe(slot1)
  }, 90000)

  it("Z5 UNBOUND: fresh zero-total order (no transfer cookie) — authority null before REAL settlement, authorized after; PRODUCTION (non-test) producer replays the order-admitted immutable snapshot (PIN + admitted data digest) -> REAL repository PROMOTED/readConfirmed, zero county reads after admission", async () => {
    const Z5 = await checkout("Z5", PROMO_CODE)
    const pending = await orderByKey(Z5.key)
    expect(await resolveAsNeutral(pending.id)).toBeNull()
    // No transfer cookie: the order has no snapshot binding row.
    const binder = jest.requireActual("@/lib/commerce/snapshot-checkout-transfer").createPostgresOrderSnapshotBindingStore({ binderUrl: env.SNAPSHOT_TEST_BINDER_URL!, readerUrl: env.SNAPSHOT_TEST_READER_URL!, ssl: "disable" })
    let bound: any; try { bound = await binder.read(pending.id) } finally { await binder.close() }
    expect(bound).toBeUndefined()
    const gatewayAtAdmission = mockGateway.calls.length
    const eventId = "evt_g1_zero5_" + hex()
    armZeroLineItems(Z5)
    expect((await deliver(eventId, "checkout.session.completed", zeroSession(Z5))).status).toBe(200)
    const order = await orderByKey(Z5.key)
    expect(order).toMatchObject({ status: "PAID", settledAmountCents: 0, settledCurrency: "usd", amountPaid: 0, checkoutAmountCents: 6900, promo: PROMO_ID, recoveryReason: null })
    const settlementLedger = await ledger(order.id)
    expect(settlementLedger).toEqual([expect.objectContaining({ orderId: order.id, sessionId: order.sid, eventId, subtotalCents: 6900, discountCents: 6900 })])
    const auth = await resolveAsNeutral(order.id)
    expect(auth).toMatchObject({ orderId: order.id, propertyPin: PIN, reservationId: Z5.reservation[0].id, dataEvidenceSha256: mockGateway.evidence.dataEvidenceSha256 })
    // The admission-time snapshot (persisted by the REAL checkout admission) is the only source of the paid facts.
    const admitted = jest.requireActual("@/lib/evidence/server/acquisition-snapshot").buildAcquisitionSnapshot(mockGateway.evidence)
    const html = officialCalendarHtml()
    const fetched: string[] = []
    const priorFetch = (global as any).fetch
    ;(global as any).fetch = async (url: string) => {
      fetched.push(String(url))
      // County transport stays reachable so any refetch would be observed (and would drift the digest).
      if (!String(url).includes("assessment-calendar")) return syntheticCountyFetch(url)
      const r = new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }); Object.defineProperty(r, "url", { value: url }); return r
    }
    const priorEnv = { NODE_ENV: process.env.NODE_ENV, A: process.env.OT_NEUTRAL_REPORT_ACTIVE, B: process.env.OT_NEUTRAL_REPORT_PRIVATE_STORAGE_ENABLED }
    try {
      Object.assign(process.env, { NODE_ENV: "production", OT_NEUTRAL_REPORT_ACTIVE: "1", OT_NEUTRAL_REPORT_PRIVATE_STORAGE_ENABLED: "true" })
      mockNeutral.role = "ot_neutral_runtime"; mockGateway.realProducerRead = true
      const { produceNeutralReport } = await import("@/lib/fulfillment-runtime/neutral-report-producer")
      const out: any = await produceNeutralReport({ orderId: order.id })
      trace.Z5 = { out, fetched, gatewayCallsAfterAdmission: mockGateway.calls.length - gatewayAtAdmission }
      expect(out).toEqual({ ok: true, receipt: expect.objectContaining({ dataEvidenceSha256: auth.dataEvidenceSha256, deadlineEvidenceSha256: expect.stringMatching(/^[0-9a-f]{64}$/) }) })
      // Zero county reads after admission (settlement, generation); exactly one calendar read at generation.
      expect(mockGateway.calls.length - gatewayAtAdmission).toBe(0)
      expect(fetched).toEqual([expect.stringContaining("assessment-calendar")])
      const { prismaNeutralReportRepository } = await import("@/lib/fulfillment-runtime/neutral-report-repository")
      const confirmed = (await prismaNeutralReportRepository.readConfirmed(out.receipt.key))!
      expect(confirmed.receipt).toEqual(out.receipt)
      const manifest = JSON.parse(confirmed.write.manifestJson)
      expect(manifest).toMatchObject({ orderId: order.id, subjectPin: PIN, dataEvidenceSha256: auth.dataEvidenceSha256 })
      expect(manifest.sharedMetric).toEqual(admitted.snapshot.sharedMetric)
      expect(manifest.sharedMetric.sampleAdequacy).toBe("NOT_QUALIFIED")
      expect(confirmed.write.dataPages.map((p: any) => Buffer.from(p.bytes).toString("base64"))).toEqual(admitted.pages.map((p: any) => Buffer.from(p.bytes).toString("base64")))
      const resv = (await admin.query(`SELECT status::text, incident_code, bundle_sha256, admission_sha256, data_evidence_sha256, superseded_by_sha256, deadline_identity_sha256, private_references FROM ot_neutral_report_reservation WHERE order_id=$1`, [order.id])).rows[0]
      trace.Z5reservation = { status: resv.status, incident: resv.incident_code }
      expect(resv).toMatchObject({ status: "PROMOTED", incident_code: null, superseded_by_sha256: null, admission_sha256: auth.admissionSha256, data_evidence_sha256: auth.dataEvidenceSha256 })
      expect(resv.bundle_sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(mockBlobs.size).toBeGreaterThanOrEqual(1)
      expect(await produceNeutralReport({ orderId: order.id })).toEqual(out) // idempotent replay
      expect(mockGateway.calls.length - gatewayAtAdmission).toBe(0)
      const dir = process.env.CALMET_EXPORT_DIR
      if (dir) {
        const fs = jest.requireActual("node:fs"), path = jest.requireActual("node:path"), d = path.join(dir, "z5-unbound-settled-zero-total"); fs.mkdirSync(d, { recursive: true })
        fs.writeFileSync(path.join(d, "report.pdf"), confirmed.write.pdf); fs.writeFileSync(path.join(d, "report.csv"), confirmed.write.csv); fs.writeFileSync(path.join(d, "manifest.json"), confirmed.write.manifestJson)
        fs.writeFileSync(path.join(d, "settlement.json"), JSON.stringify({ order: await orderByKey(Z5.key), ledger: settlementLedger, binding: null, admittedSnapshotRef: { id: admitted.id, sha256: admitted.sha256 }, admittedSharedMetric: admitted.snapshot.sharedMetric, authorityBeforeSettlement: null, authorityAfterSettlement: auth, receipt: out.receipt, reservation: resv, countyReadsAfterAdmission: 0, calendarReads: fetched }, null, 2))
      }
    } finally {
      Object.assign(process.env, { NODE_ENV: priorEnv.NODE_ENV }); if (priorEnv.A === undefined) delete process.env.OT_NEUTRAL_REPORT_ACTIVE; if (priorEnv.B === undefined) delete process.env.OT_NEUTRAL_REPORT_PRIVATE_STORAGE_ENABLED
      ;(global as any).fetch = priorFetch; mockGateway.realProducerRead = false
    }
  }, 120000)

  it("Z6 F1: BOUND zero-total order — REAL free acquisition snapshot -> REAL transfer cookie -> REAL checkout binding -> REAL signed settlement (PAID at 0) -> authority null->authorized -> PRODUCTION producer -> REAL repository PROMOTED/readConfirmed, zero county reads", async () => {
    // Free side: the REAL free adapter persists the immutable acquisition snapshot (county read happens here, before any order).
    const free: any = await (await import("@/lib/evidence/server/county-factual-acquisition")).createCountyFactualAdapter().acquire({ pin: PIN })
    expect(free.ok).toBe(true)
    const ref = free.acquisitionSnapshot
    const { createSnapshotTransferAuthority, createPostgresOrderSnapshotBindingStore } = await import("@/lib/commerce/snapshot-checkout-transfer")
    const cookie = (createSnapshotTransferAuthority({ secret: process.env.NEXTAUTH_SECRET }).issueCookie({ snapshotId: ref.id, sha256: ref.sha256, pin: PIN }) as string).split(";")[0]
    const gatewayAtBinding = mockGateway.calls.length
    const Z6 = await checkout("Z6", PROMO_CODE, cookie)
    const binder = createPostgresOrderSnapshotBindingStore({ binderUrl: env.SNAPSHOT_TEST_BINDER_URL!, readerUrl: env.SNAPSHOT_TEST_READER_URL!, ssl: "disable" })
    let bound: any; try { bound = await binder.read(Z6.order.id) } finally { await binder.close() }
    expect(bound).toMatchObject({ snapshotId: ref.id, sha256: ref.sha256, pin: PIN })
    expect(await resolveAsNeutral(Z6.order.id)).toBeNull()
    const eventId = "evt_g1_zero6_" + hex()
    armZeroLineItems(Z6)
    expect((await deliver(eventId, "checkout.session.completed", zeroSession(Z6))).status).toBe(200)
    const order = await orderByKey(Z6.key)
    expect(order).toMatchObject({ status: "PAID", settledAmountCents: 0, settledCurrency: "usd", amountPaid: 0, checkoutAmountCents: 6900, promo: PROMO_ID, recoveryReason: null })
    const settlementLedger = await ledger(order.id)
    expect(settlementLedger).toEqual([expect.objectContaining({ orderId: order.id, sessionId: order.sid, eventId, subtotalCents: 6900, discountCents: 6900 })])
    const auth = await resolveAsNeutral(order.id)
    expect(auth).toMatchObject({ orderId: order.id, propertyPin: PIN, reservationId: Z6.reservation[0].id, dataEvidenceSha256: free.acquisitionSnapshot.dataEvidenceSha256 })
    const html = officialCalendarHtml(), fetched: string[] = []
    const priorFetch = (global as any).fetch
    ;(global as any).fetch = async (url: string) => {
      fetched.push(String(url))
      if (!String(url).includes("assessment-calendar")) throw new Error("NETWORK_FORBIDDEN_IN_TEST")
      const r = new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }); Object.defineProperty(r, "url", { value: url }); return r
    }
    const priorEnv = { NODE_ENV: process.env.NODE_ENV, A: process.env.OT_NEUTRAL_REPORT_ACTIVE, B: process.env.OT_NEUTRAL_REPORT_PRIVATE_STORAGE_ENABLED }
    try {
      Object.assign(process.env, { NODE_ENV: "production", OT_NEUTRAL_REPORT_ACTIVE: "1", OT_NEUTRAL_REPORT_PRIVATE_STORAGE_ENABLED: "true" })
      mockNeutral.role = "ot_neutral_runtime"
      const { produceNeutralReport } = await import("@/lib/fulfillment-runtime/neutral-report-producer")
      const out: any = await produceNeutralReport({ orderId: order.id })
      trace.Z6 = { out, fetched, gatewayCallsAfterBinding: mockGateway.calls.length - gatewayAtBinding }
      expect(out).toEqual({ ok: true, receipt: expect.objectContaining({ dataEvidenceSha256: auth.dataEvidenceSha256 }) })
      // Zero county reads after binding (checkout, settlement, generation); exactly one calendar read at generation.
      expect(mockGateway.calls.length - gatewayAtBinding).toBe(0)
      expect(fetched).toEqual([expect.stringContaining("assessment-calendar")])
      const { prismaNeutralReportRepository } = await import("@/lib/fulfillment-runtime/neutral-report-repository")
      const confirmed = (await prismaNeutralReportRepository.readConfirmed(out.receipt.key))!
      expect(confirmed.receipt).toEqual(out.receipt)
      const manifest = JSON.parse(confirmed.write.manifestJson)
      expect(manifest.sharedMetric).toEqual(free.acquisitionSnapshot.sharedMetric)
      expect(manifest.sharedMetric.sampleAdequacy).toBe("NOT_QUALIFIED")
      const resv = (await admin.query(`SELECT status::text, incident_code, bundle_sha256, admission_sha256, data_evidence_sha256, deadline_identity_sha256, private_references FROM ot_neutral_report_reservation WHERE order_id=$1`, [order.id])).rows[0]
      expect(resv).toMatchObject({ status: "PROMOTED", incident_code: null, admission_sha256: auth.admissionSha256, data_evidence_sha256: auth.dataEvidenceSha256 })
      expect(await produceNeutralReport({ orderId: order.id })).toEqual(out) // idempotent replay
      const dir = process.env.CALMET_EXPORT_DIR
      if (dir) {
        const fs = jest.requireActual("node:fs"), path = jest.requireActual("node:path"), d = path.join(dir, "z6-bound-settled-zero-total"); fs.mkdirSync(d, { recursive: true })
        fs.writeFileSync(path.join(d, "report.pdf"), confirmed.write.pdf); fs.writeFileSync(path.join(d, "report.csv"), confirmed.write.csv); fs.writeFileSync(path.join(d, "manifest.json"), confirmed.write.manifestJson)
        fs.writeFileSync(path.join(d, "settlement.json"), JSON.stringify({ order: await orderByKey(Z6.key), ledger: settlementLedger, snapshotRef: { id: ref.id, sha256: ref.sha256 }, binding: bound, freeSharedMetric: free.acquisitionSnapshot.sharedMetric, authorityBeforeSettlement: null, authorityAfterSettlement: auth, receipt: out.receipt, reservation: resv, countyReadsAfterBinding: 0, calendarReads: fetched }, null, 2))
      }
    } finally {
      Object.assign(process.env, { NODE_ENV: priorEnv.NODE_ENV }); if (priorEnv.A === undefined) delete process.env.OT_NEUTRAL_REPORT_ACTIVE; if (priorEnv.B === undefined) delete process.env.OT_NEUTRAL_REPORT_PRIVATE_STORAGE_ENABLED
      ;(global as any).fetch = priorFetch
    }
  }, 120000)

  it("W NEGATIVE (must stay refused): wrong promotion on the provider discount -> recovery, no ledger, no authority; REAL binder refuses the wrong promotion", async () => {
    const W = await checkout("W", PROMO_CODE)
    armZeroLineItems(W, "promo_g1_other")
    const r = await deliver("evt_g1_wrongpromo_" + hex(), "checkout.session.completed", zeroSession(W))
    expect(r.status).toBe(200)
    const order = await orderByKey(W.key)
    expect(order).toMatchObject({ status: "PAID_RECOVERY_REQUIRED", settledAmountCents: 0 })
    expect(order.recoveryReason).toMatch(/full-discount evidence/)
    expect(await ledger(order.id)).toEqual([])
    await anyBinderError(mockAppPrisma().$transaction((tx: any) => bindZeroTotalSettlement(tx, { orderId: order.id, sessionId: order.sid, eventId: "evt_g1_w_direct", promotionCodeId: "promo_g1_other", couponId: COUPON_ID, subtotalCents: 6900, discountCents: 6900, currency: "usd" })))
    expect(await ledger(order.id)).toEqual([])
    expect(await neutralPaymentAuthority(order.id)).toBe(false)
    expect(enqueueFor(order.id)).toEqual([])
    expect(await ensureAsNeutral(order.id)).toBeNull()
    expect(await resolveAsNeutral(order.id)).toBeNull()
    expect(await workRows(order.id)).toEqual([])
    expect((await reservations(order.id))[0].paidSlot).toBeNull()
  }, 90000)

  it("A NEGATIVE (must stay refused): amount mismatch (provider subtotal 6800 vs durable 6900) -> recovery, no ledger, no authority; REAL binder refuses 6800", async () => {
    const A = await checkout("A", PROMO_CODE)
    armZeroLineItems(A)
    const r = await deliver("evt_g1_amount_" + hex(), "checkout.session.completed", zeroSession(A, { amount_subtotal: 6800, total_details: { amount_discount: 6800, amount_shipping: 0, amount_tax: 0 } }))
    expect(r.status).toBe(200)
    const order = await orderByKey(A.key)
    expect(order).toMatchObject({ status: "PAID_RECOVERY_REQUIRED", recoveryReason: "DURABLE_CONTRACT_MISMATCH" })
    expect(await ledger(order.id)).toEqual([])
    await anyBinderError(mockAppPrisma().$transaction((tx: any) => bindZeroTotalSettlement(tx, { orderId: order.id, sessionId: order.sid, eventId: "evt_g1_a_direct", promotionCodeId: PROMO_ID, couponId: COUPON_ID, subtotalCents: 6800, discountCents: 6800, currency: "usd" })))
    await anyBinderError(mockAppPrisma().$transaction((tx: any) => bindZeroTotalSettlement(tx, { orderId: order.id, sessionId: order.sid, eventId: "evt_g1_a_partial", promotionCodeId: PROMO_ID, couponId: COUPON_ID, subtotalCents: 6900, discountCents: 6800, currency: "usd" })))
    expect(await ledger(order.id)).toEqual([])
    expect(await neutralPaymentAuthority(order.id)).toBe(false)
    expect(enqueueFor(order.id)).toEqual([])
    expect(await ensureAsNeutral(order.id)).toBeNull()
    expect(await resolveAsNeutral(order.id)).toBeNull()
    expect(await workRows(order.id)).toEqual([])
  }, 90000)

  it("M NEGATIVE (must stay refused): zero-total order with NO immutable ledger (never settled) — refused; REAL binder refuses wrong session; ledger is append-only", async () => {
    const M = await checkout("M", PROMO_CODE)
    const order = await orderByKey(M.key)
    expect(order).toMatchObject({ status: "CHECKOUT_CREATED", promo: PROMO_ID })
    await anyBinderError(mockAppPrisma().$transaction((tx: any) => bindZeroTotalSettlement(tx, { orderId: order.id, sessionId: "cs_test_g1_foreign_" + hex(), eventId: "evt_g1_m_session", promotionCodeId: PROMO_ID, couponId: COUPON_ID, subtotalCents: 6900, discountCents: 6900, currency: "usd" })))
    await anyBinderError(mockAppPrisma().$transaction((tx: any) => bindZeroTotalSettlement(tx, { orderId: order.id, sessionId: order.sid, eventId: "evt_g1_m_currency", promotionCodeId: PROMO_ID, couponId: COUPON_ID, subtotalCents: 6900, discountCents: 6900, currency: "eur" })))
    expect(await ledger(order.id)).toEqual([])
    expect(await neutralPaymentAuthority(order.id)).toBe(false)
    expect(await ensureAsNeutral(order.id)).toBeNull()
    expect(await resolveAsNeutral(order.id)).toBeNull()
    expect(await workRows(order.id)).toEqual([])
    expect((await reservations(order.id))[0].paidSlot).toBeNull()
    // The legitimate Z ledger row cannot be rewritten or removed (immutable trigger), even by the superuser.
    if (!S.Z) throw new Error("G1_DEPENDENCY Z0 did not complete")
    await expect(admin.query(`UPDATE ot_zero_total_settlement SET discount_cents=discount_cents WHERE order_id=$1`, [S.Z.order.id])).rejects.toThrow(/append-only/)
    await expect(admin.query(`DELETE FROM ot_zero_total_settlement WHERE order_id=$1`, [S.Z.order.id])).rejects.toThrow(/append-only/)
  }, 90000)

  it("R CONTROL (must PASS): paid 6900 order reversed via REAL signed charge.refunded -> SETTLEMENT_HOLD -> ensure/resolve refuse", async () => {
    const R = await checkout("R")
    const pi = "pi_g1_reversed_" + hex()
    armPaidLineItems(R)
    expect((await deliver("evt_g1_rpaid_" + hex(), "checkout.session.completed", paidSession(R, pi))).status).toBe(200)
    const paid = await orderByKey(R.key)
    expect(paid).toMatchObject({ status: "PAID", settledAmountCents: 6900, amountPaid: 69 })
    const work = await workRows(paid.id)
    expect(work).toHaveLength(1)
    const rev = await deliver("evt_g1_refund_" + hex(), "charge.refunded", { id: "ch_g1_" + hex(), object: "charge", payment_intent: pi })
    expect(rev.status).toBe(200)
    expect((await orderByKey(R.key)).status).toBe("SETTLEMENT_HOLD")
    expect(await neutralPaymentAuthority(paid.id)).toBe(false)
    expect(await ensureAsNeutral(paid.id)).toBeNull()
    expect(await resolveAsNeutral(paid.id)).toBeNull()
    expect((await workRows(paid.id)).map(w => w.id)).toEqual(work.map(w => w.id))
    expect((await reservations(paid.id))[0].paidSlot).toBeNull()
  }, 90000)

  it("F FAIL-CLOSED guards (must PASS): empty / oversize / unknown order ids; neutral role cannot read the raw ledger", async () => {
    for (const bad of ["", "x".repeat(129)]) {
      expect(await ensureAsNeutral(bad)).toBeNull()
      expect(await resolveAsNeutral(bad)).toBeNull()
    }
    const ghost = "g1_ghost_" + hex()
    expect(await ensureAsNeutral(ghost)).toBeNull()
    expect(await resolveAsNeutral(ghost)).toBeNull()
    expect(await workRows(ghost)).toEqual([])
    mockNeutral.role = "ot_neutral_runtime"
    await expect(mockNeutralPrisma().$queryRaw(Prisma.sql`SELECT 1 FROM "ot_zero_total_settlement"`)).rejects.toThrow(/permission denied/)
    await expect(mockNeutralPrisma().$queryRaw(Prisma.sql`SELECT 1 FROM "ot_order"`)).rejects.toThrow(/permission denied/)
    // Paid controls registered production in after() (captured, never run).
    expect(mockAfter.callbacks.length).toBeGreaterThanOrEqual(1)
  })
})
