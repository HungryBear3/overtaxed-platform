/** @jest-environment node */

/**
 * The checkout route is the authority on what attribution reaches Stripe.
 *
 * The browser submits its stored first touch and last non-direct touch plus the
 * GA identifiers it read; the route revalidates every one of them against the
 * same contracts before stamping Stripe metadata, and invalid input degrades to
 * "no attribution" rather than refusing a purchase. Provider, database and
 * county data are mocked (harness follows session-window-gates.test.ts), with
 * the approved-code binding left at its default: off.
 */

jest.mock("stripe", () => {
  const create = jest.fn(async () => ({ id: "cs_test_touch", url: "https://checkout.stripe.test/touch" }))
  const retrievePrice = jest.fn(async (id: string) => ({
    id,
    active: true,
    type: "one_time",
    unit_amount: 6900,
    currency: "usd",
  }))
  const Stripe = jest.fn().mockImplementation(() => ({ checkout: { sessions: { create } }, prices: { retrieve: retrievePrice } }))
  return { __esModule: true, default: Stripe, __create: create, __retrievePrice: retrievePrice }
})

jest.mock("@/lib/marketing/preview-gate", () => ({
  hostFromRequest: jest.fn(() => "www.overtaxed-il.com"),
  isPreviewStubEnabled: jest.fn(() => false),
  marketingGateReason: jest.fn(() => "test"),
  previewNoopResponseBody: jest.fn(() => ({ mode: "preview_noop" })),
}))

jest.mock("@/lib/rate-limit", () => ({
  rateLimit: jest.fn(() => ({ allowed: true })),
  getClientIdentifier: jest.fn(() => "test-client"),
}))

jest.mock("@/lib/cook-county", () => ({
  searchPropertiesByAddress: jest.fn(async () => ({
    success: true,
    data: [{ pin: "13243140450000", property_address: "2834 W HENDERSON ST", property_city: "CHICAGO" }],
  })),
  getPropertyByPIN: jest.fn(async () => ({
    success: true,
    data: { pin: "13243140450000", address: "2834 W HENDERSON ST", city: "CHICAGO", zipCode: "60618", township: "Jefferson" },
  })),
  normalizePIN: (value: string) => value.replace(/\D/g, ""),
}))

const mockSnapshot: {
  schemaVersion: number
  synthetic: boolean
  sources: Record<string, unknown>
  townships: Record<string, unknown>
} = { schemaVersion: 1, synthetic: true, sources: {}, townships: {} }

jest.mock("@/data/deadlines/cook-county.json", () => mockSnapshot)
jest.mock("@/lib/deadlines/commerce-deadline-authority", () => ({
  projectCommerceDeadline: jest.fn(async ({ township, at }: { township: unknown; at: Date }) => {
    const { evaluateOfficialDeadlineState, projectDeadline } = jest.requireActual("@/lib/deadlines/official-source-state")
    return projectDeadline(evaluateOfficialDeadlineState({ snapshot: mockSnapshot, township, stage: "assessor", evaluatedAt: at.toISOString() }), at.toISOString())
  }),
}))

jest.mock("@/lib/checkout/ot-contract", () => {
  const actual = jest.requireActual("@/lib/checkout/ot-contract")
  return {
    ...actual,
    signedPolicyVersion: () => "test-policy-2026-08-19",
    resolveEligibilityPolicy: () => ({
      signed: true,
      version: "test-policy-2026-08-19",
      ownerDecisions: ["OD-2", "OD-3"],
      signedAt: "2026-08-19",
      evidenceThreshold: { minRelativeAssessmentGap: 0.15, minComparables: 3 },
    }),
  }
})

jest.mock("@/lib/db", () => {
  const upsert = jest.fn(async ({ create }: { create: Record<string, unknown> }) => ({ id: "ord_touch_1", ...create }))
  const update = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "ord_touch_1", ...data }))
  const updateMany = jest.fn(async () => ({ count: 1 }))
  return { prisma: { oTOrder: { upsert, update, updateMany } } }
})

const stripeCreate = (jest.requireMock("stripe") as { __create: jest.Mock }).__create

process.env.STRIPE_SECRET_KEY = "sk_test_touch"
process.env.STRIPE_PRICE_T2_DIY_PRO = "price_t2"
process.env.STRIPE_PRICE_T3_DFY = "price_t3"
process.env.OT_CHECKOUT_GATE_SECRET = "test-gate-secret-at-least-32-characters"
delete process.env.OT_ORDER_ATTRIBUTION_ENABLED

const { POST } = require("@/app/api/checkout/session/route") as typeof import("@/app/api/checkout/session/route")

const DAY = 24 * 60 * 60 * 1000
const CALENDAR_URL = "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines"

function countyDay(days: number, from: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(from.getTime() + days * DAY))
}

function armOpenWindow() {
  const now = new Date()
  const source = {
    authority: "cook_county_assessor",
    sourceUrl: CALENDAR_URL,
    retrievedAt: new Date(now.getTime() - 5000).toISOString(),
    sourceUpdatedAt: null,
    contentSha256: "e".repeat(64),
    httpStatus: 200,
    finalUrl: CALENDAR_URL,
    parseStatus: "ok",
    parserVersion: "1.0.0",
  }
  mockSnapshot.synthetic = false
  mockSnapshot.sources = { assessor: source, bor: source }
  mockSnapshot.townships = {
    jefferson: {
      townshipName: "Jefferson",
      stages: { assessor: { noticeDate: null, openDate: countyDay(-10, now), lastFileDate: countyDay(20, now) } },
    },
  }
}

function request(body: Record<string, unknown>) {
  return new Request("https://www.overtaxed-il.com/api/checkout/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const base = {
  tier: "T2",
  email: "buyer@example.com",
  name: "Buyer Name",
  address: "2834 W Henderson St, Chicago IL 60618",
  checkoutKey: "57dc81a6-1329-4a85-9210-0d6f574ea65d",
}

/** Take the T2 acknowledgment challenge and present it back, as the page does. */
async function postT2(extra: Record<string, unknown>) {
  const challenge = await POST(request({ ...base, ...extra }) as never)
  const { acknowledgmentToken } = await challenge.json()
  return POST(request({ ...base, analysisAcknowledged: true, acknowledgmentToken, ...extra }) as never)
}

function lastMetadata(): Record<string, string> {
  const calls = stripeCreate.mock.calls as unknown as Array<[{ metadata: Record<string, string> }]>
  return calls[calls.length - 1][0].metadata
}

function touchKeys(metadata: Record<string, string>): string[] {
  return Object.keys(metadata).filter((key) => /^(first|last)Touch/.test(key)).sort()
}

/** A whole-second instant `daysAgo` before now, and its UTC second-precision form. */
function instant(daysAgo: number): { at: number; iso: string } {
  const at = Math.floor((Date.now() - daysAgo * DAY) / 1000) * 1000
  return { at, iso: new Date(at).toISOString().replace(".000Z", "Z") }
}

beforeEach(() => {
  jest.clearAllMocks()
  armOpenWindow()
})

describe("submitted attribution touches", () => {
  it("stamps no touch whose campaign tuple is not owner-approved, beside the GA identifiers, and still checks out", async () => {
    const first = instant(3)
    const last = instant(1)

    const res = await postT2({
      attribution: {
        first: { source: "property_manager", medium: "email", campaign: "hoa_resident_resource_20260723", landing: "/hoa", at: first.at },
        last: {
          source: "facebook",
          medium: "paid_social",
          campaign: "ot_2026_cicero_deadline",
          content: "v1_video",
          term: "appeal",
          landing: "/appeal-deadline/[slug]",
          at: last.at,
        },
      },
      gaClientId: "1234567890.1724102400",
      gaSessionId: "1724102400",
      gaSessionNumber: "4",
    })

    expect(res.status).toBe(200)
    expect(stripeCreate).toHaveBeenCalledTimes(1)
    expect(lastMetadata()).toMatchObject({
      orderId: "ord_touch_1",
      tier: "T2",
      gaClientId: "1234567890.1724102400",
      gaSessionId: "1724102400",
      gaSessionNumber: "4",
    })
    expect(touchKeys(lastMetadata())).toEqual([])
  })

  it("stamps nothing from a canonical tuple whose slug is not owner-approved, and never a term", async () => {
    const { at } = instant(1)

    const res = await postT2({
      attribution: {
        first: { landing: "/", at },
        last: { source: "reddit", medium: "paid_social", campaign: "ot_202610_acq_synthappeal", content: "img_a", term: "springfield", landing: "/", at },
      },
    })

    expect(res.status).toBe(200)
    expect(touchKeys(lastMetadata())).toEqual(["firstTouchAt", "firstTouchLanding"])
    expect(JSON.stringify(lastMetadata())).not.toContain("springfield")
  })

  it("keeps every stamped value inside Stripe's metadata limits and stamps no maximum-length ungoverned value", async () => {
    const { at } = instant(1)

    await postT2({
      attribution: {
        first: { source: "s".repeat(40), medium: "m".repeat(40), campaign: "c".repeat(100), content: "x".repeat(100), term: "t".repeat(60), landing: "/appeal-deadline/[slug]", at },
        last: { source: "s".repeat(40), medium: "m".repeat(40), campaign: "c".repeat(100), content: "x".repeat(100), term: "t".repeat(60), landing: "/appeal-deadline/[slug]", at },
      },
    })

    const metadata = lastMetadata()
    expect(touchKeys(metadata)).toEqual([])
    expect(Object.keys(metadata).length).toBeLessThanOrEqual(50)
    for (const [key, value] of Object.entries(metadata)) {
      expect(key.length).toBeLessThanOrEqual(40)
      expect(value.length).toBeLessThanOrEqual(500)
    }
  })

  it("drops hostile touches, stamps nothing from them, and still creates the checkout session", async () => {
    const { at } = instant(1)

    const res = await postT2({
      attribution: {
        first: { source: "owner@example.com", medium: "email", landing: "/hoa", at },
        last: { campaign: "ot_2026_cicero_deadline", term: "16-01-216-001-0000", landing: "/check?pin=16012160010000", at },
      },
    })

    expect(res.status).toBe(200)
    expect(stripeCreate).toHaveBeenCalledTimes(1)
    const metadata = lastMetadata()
    expect(touchKeys(metadata)).toEqual([])
    const serialized = JSON.stringify(metadata)
    for (const forbidden of ["owner@example.com", "16-01-216-001-0000", "16012160010000", "?", "#"]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it("stamps a direct first touch but not a direct touch as the last non-direct touch", async () => {
    const first = instant(2)
    const last = instant(1)

    await postT2({ attribution: { first: { landing: "/", at: first.at }, last: { landing: "/check", at: last.at } } })

    expect(touchKeys(lastMetadata())).toEqual(["firstTouchAt", "firstTouchLanding"])
    expect(lastMetadata()).toMatchObject({ firstTouchLanding: "/", firstTouchAt: first.iso })
  })

  it("does not stamp a touch older than the attribution window", async () => {
    await postT2({ attribution: { first: { source: "partner", at: instant(31).at } } })

    expect(touchKeys(lastMetadata())).toEqual([])
  })

  it.each([
    ["a query string", "utm_source=partner"],
    ["an array", [{ source: "partner", at: Date.now() }]],
    ["an object with unknown top-level keys", { first: { source: "partner", at: Date.now() }, email: "buyer@example.com" }],
    ["null", null],
  ])("treats %s as no attribution rather than refusing checkout", async (_label, attribution) => {
    const res = await postT2({ attribution })

    expect(res.status).toBe(200)
    expect(stripeCreate).toHaveBeenCalledTimes(1)
    expect(touchKeys(lastMetadata())).toEqual([])
  })
})

describe("submitted GA identifiers", () => {
  it("revalidates identifiers to their exact shapes before they reach Stripe", async () => {
    const res = await postT2({ gaClientId: "1.2", gaSessionId: "0724102400", gaSessionNumber: "1000000" })

    expect(res.status).toBe(200)
    const metadata = lastMetadata()
    expect(metadata).not.toHaveProperty("gaClientId")
    expect(metadata).not.toHaveProperty("gaSessionId")
    expect(metadata).not.toHaveProperty("gaSessionNumber")
  })
})

// A module, not a script: this file loads the route with `require` after its
// mocks, so without an export TypeScript would merge its top-level names into
// the global scope shared with other script-style suites.
export {}
