/**
 * @jest-environment node
 *
 * The assessment-increase email goes out from inside `runAssessmentChecks`, so
 * that is where these tests drive it: a synthetic monitored property, a
 * synthetic official record showing a higher assessed value, mocked
 * persistence and a mocked `sendEmail`. The real transport module is replaced
 * by a factory that throws, so loading it at all fails the suite.
 *
 * What must hold:
 *   - the increase email is default-off: it sends only when
 *     OT_ASSESSMENT_INCREASE_EMAIL_ENABLED is exactly "true" AND
 *     OT_ASSESSMENT_INCREASE_EMAIL_DRY_RUN is exactly "false";
 *   - a Vercel Preview deployment never sends it, whatever the switches say;
 *   - assessment persistence and the appeal-decision email are untouched by
 *     either switch.
 */

const PROPERTY_ID = "prop_synthetic_1"
const USER_EMAIL = "synthetic-owner@example.test"

type Prop = {
  id: string
  pin: string
  address: string
  township: string | null
  user: { id: string; email: string | null; name: string | null } | null
}

let properties: Prop[] = []
let storedLatest: { taxYear: number; assessmentValue: number } | null = null
let openAppeals: Array<Record<string, unknown>> = []
let officialHistory: Array<Record<string, number>> = []

const prismaMock = {
  property: {
    findMany: jest.fn(async () => properties),
    update: jest.fn(async () => ({})),
    findUnique: jest.fn(async () => ({ taxRate: 0.07, stateEqualizer: 3 })),
  },
  assessmentHistory: {
    findMany: jest.fn(async () => (storedLatest ? [{ taxYear: storedLatest.taxYear }] : [])),
    findFirst: jest.fn(async () => storedLatest),
    upsert: jest.fn(async () => ({})),
  },
  appeal: {
    findMany: jest.fn(async () => openAppeals),
    update: jest.fn(async () => ({})),
  },
}

jest.mock("@/lib/db", () => ({
  get prisma() {
    return prismaMock
  },
}))

const getPropertyByPIN = jest.fn(async () => ({
  success: true,
  data: { township: "Lake View", assessmentHistory: officialHistory },
}))
jest.mock("@/lib/cook-county", () => ({
  getPropertyByPIN: (...args: unknown[]) => getPropertyByPIN(...(args as [])),
  formatPIN: (pin: string) => pin,
}))

const sendEmail = jest.fn(async () => true)
jest.mock("@/lib/email", () => ({ sendEmail: (...args: unknown[]) => sendEmail(...(args as [])) }))

let emailConfigured = true
jest.mock("@/lib/email/config", () => ({ isEmailConfigured: () => emailConfigured }))

// Zero real transport: if anything reaches for the Resend client, fail loudly.
jest.mock("@/lib/email/resend", () => {
  throw new Error("real email transport must never load in this suite")
})

import { runAssessmentChecks } from "@/lib/monitoring/assessment-check"

const SWITCHES = [
  "OT_ASSESSMENT_INCREASE_EMAIL_ENABLED",
  "OT_ASSESSMENT_INCREASE_EMAIL_DRY_RUN",
  "VERCEL_ENV",
  "NEXT_PUBLIC_APP_URL",
] as const
const saved: Record<string, string | undefined> = {}
const fetchGuard = jest.fn(() => {
  throw new Error("network must never be touched in this suite")
})
const realFetch = global.fetch

function setEnv(env: Partial<Record<(typeof SWITCHES)[number], string>>) {
  for (const key of SWITCHES) delete process.env[key]
  Object.assign(process.env, env)
}

function arm(extra: Partial<Record<(typeof SWITCHES)[number], string>> = {}) {
  setEnv({
    OT_ASSESSMENT_INCREASE_EMAIL_ENABLED: "true",
    OT_ASSESSMENT_INCREASE_EMAIL_DRY_RUN: "false",
    VERCEL_ENV: "production",
    NEXT_PUBLIC_APP_URL: "https://example.test",
    ...extra,
  })
}

function increaseEmails() {
  return sendEmail.mock.calls.filter((c) => /assessment/i.test((c as unknown as [{ subject: string }])[0].subject))
}

function decisionEmails() {
  return sendEmail.mock.calls.filter((c) => /appeal result/i.test((c as unknown as [{ subject: string }])[0].subject))
}

beforeAll(() => {
  for (const key of SWITCHES) saved[key] = process.env[key]
  global.fetch = fetchGuard as unknown as typeof fetch
})

afterAll(() => {
  for (const key of SWITCHES) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  global.fetch = realFetch
})

beforeEach(() => {
  jest.clearAllMocks()
  emailConfigured = true
  properties = [
    {
      id: PROPERTY_ID,
      pin: "14-20-100-001-0000",
      address: "123 Synthetic St",
      township: "Lake View",
      user: { id: "user_1", email: USER_EMAIL, name: "Pat" },
    },
  ]
  storedLatest = { taxYear: 2025, assessmentValue: 30000 }
  openAppeals = []
  officialHistory = [
    { year: 2026, assessedTotalValue: 36000, assessedLandValue: 6000, assessedBuildingValue: 30000, marketValue: 360000 },
    { year: 2025, assessedTotalValue: 30000, assessedLandValue: 5000, assessedBuildingValue: 25000, marketValue: 300000 },
  ]
  setEnv({ NEXT_PUBLIC_APP_URL: "https://example.test" })
})

describe("assessment-increase email: default-off at the send seam", () => {
  it("does not send when the enable switch is omitted, even with dry-run off", async () => {
    setEnv({ OT_ASSESSMENT_INCREASE_EMAIL_DRY_RUN: "false", VERCEL_ENV: "production" })
    const [r] = await runAssessmentChecks()
    expect(r.increaseDetected).toBe(true)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(r.increaseEmail).toBe("disabled")
  })

  it.each(["TRUE", "True", "1", "yes", "on", " true", "true ", ""])(
    "does not send for non-canonical enable value %p",
    async (value) => {
      arm({ OT_ASSESSMENT_INCREASE_EMAIL_ENABLED: value })
      const [r] = await runAssessmentChecks()
      expect(r.increaseDetected).toBe(true)
      expect(sendEmail).not.toHaveBeenCalled()
      expect(r.increaseEmail).toBe("disabled")
    }
  )

  it("enabled with dry-run omitted defaults to dry-run: no provider attempt", async () => {
    arm()
    delete process.env.OT_ASSESSMENT_INCREASE_EMAIL_DRY_RUN
    const info = jest.spyOn(console, "info").mockImplementation(() => {})
    const [r] = await runAssessmentChecks()
    expect(sendEmail).not.toHaveBeenCalled()
    expect(r.increaseEmail).toBe("dry_run")
    const logged = info.mock.calls.map((c) => c.join(" ")).join("\n")
    expect(logged).toMatch(/dry-run/)
    expect(logged).toContain(PROPERTY_ID)
    expect(logged).not.toContain(USER_EMAIL)
    info.mockRestore()
  })

  it("enabled with dry-run=true does not send", async () => {
    arm({ OT_ASSESSMENT_INCREASE_EMAIL_DRY_RUN: "true" })
    jest.spyOn(console, "info").mockImplementation(() => {})
    const [r] = await runAssessmentChecks()
    expect(sendEmail).not.toHaveBeenCalled()
    expect(r.increaseEmail).toBe("dry_run")
  })

  it.each(["FALSE", "False", "0", "no", "off", " false", ""])(
    "malformed dry-run value %p stays in dry-run",
    async (value) => {
      arm({ OT_ASSESSMENT_INCREASE_EMAIL_DRY_RUN: value })
      jest.spyOn(console, "info").mockImplementation(() => {})
      const [r] = await runAssessmentChecks()
      expect(sendEmail).not.toHaveBeenCalled()
      expect(r.increaseEmail).toBe("dry_run")
    }
  )

  it("a Preview deployment never sends, even fully armed", async () => {
    arm({ VERCEL_ENV: "preview" })
    jest.spyOn(console, "info").mockImplementation(() => {})
    const [r] = await runAssessmentChecks()
    expect(r.increaseDetected).toBe(true)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(r.increaseEmail).toBe("preview_blocked")
  })

  it("sends exactly one factual email when enabled=true and dry-run=false", async () => {
    arm()
    const [r] = await runAssessmentChecks()
    expect(r.increaseEmail).toBe("sent")
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const msg = (sendEmail.mock.calls[0] as unknown as [{ to: string; subject: string; text: string; html: string }])[0]
    expect(msg.to).toBe(USER_EMAIL)
    expect(msg.subject).toContain("123 Synthetic St")
    expect(msg.subject).toContain("2026")
    expect(msg.text).toContain(`https://example.test/properties/${PROPERTY_ID}`)
    expect(msg.html).toContain(`https://example.test/properties/${PROPERTY_ID}`)
    expect(msg.text).toContain("$30,000")
    expect(msg.text).toContain("$36,000")
    for (const body of [msg.subject, msg.text, msg.html]) {
      expect(body).not.toMatch(/may be able to appeal/i)
      expect(body).not.toMatch(/\bappeal/i)
      expect(body).not.toMatch(/deadline|days left|file by/i)
      expect(body).not.toMatch(/checkout|pricing|purchase|buy now|\/start|\/check\b/i)
    }
    expect(fetchGuard).not.toHaveBeenCalled()
  })
})

describe("assessment-increase email: preconditions still apply when armed", () => {
  it("no increase -> no increase email", async () => {
    arm()
    storedLatest = { taxYear: 2026, assessmentValue: 36000 }
    const [r] = await runAssessmentChecks()
    expect(r.increaseDetected).toBe(false)
    expect(r.increaseEmail).toBeUndefined()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("no stored prior value -> no increase email", async () => {
    arm()
    storedLatest = null
    const [r] = await runAssessmentChecks()
    expect(r.increaseDetected).toBe(false)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("owner without an email -> no increase email", async () => {
    arm()
    properties[0].user = { id: "user_1", email: null, name: "Pat" }
    const [r] = await runAssessmentChecks()
    expect(r.increaseDetected).toBe(true)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(r.increaseEmail).toBe("skipped")
  })

  it("email not configured -> no increase email", async () => {
    arm()
    emailConfigured = false
    const [r] = await runAssessmentChecks()
    expect(r.increaseDetected).toBe(true)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(r.increaseEmail).toBe("skipped")
  })
})

describe("assessment persistence and decision email are unaffected by the increase switches", () => {
  async function persistenceSnapshot() {
    jest.clearAllMocks()
    jest.spyOn(console, "info").mockImplementation(() => {})
    const results = await runAssessmentChecks()
    return {
      results: results.map(({ increaseEmail: _ignored, ...rest }) => rest),
      propertyUpdates: prismaMock.property.update.mock.calls.map((c) => {
        const arg = (c as unknown as [{ where: unknown; data: Record<string, unknown> }])[0]
        const { lastCheckedAt, ...data } = arg.data
        expect(lastCheckedAt).toBeInstanceOf(Date)
        return { where: arg.where, data }
      }),
      upserts: prismaMock.assessmentHistory.upsert.mock.calls,
    }
  }

  it("records the same property and history updates whether disabled, dry-run, preview or armed", async () => {
    setEnv({ NEXT_PUBLIC_APP_URL: "https://example.test" })
    const disabled = await persistenceSnapshot()
    arm({ OT_ASSESSMENT_INCREASE_EMAIL_DRY_RUN: "true" })
    const dryRun = await persistenceSnapshot()
    arm({ VERCEL_ENV: "preview" })
    const preview = await persistenceSnapshot()
    arm()
    const armed = await persistenceSnapshot()

    expect(disabled.upserts).toHaveLength(2)
    expect(disabled.propertyUpdates).toEqual([
      {
        where: { id: PROPERTY_ID },
        data: {
          currentAssessmentValue: 36000,
          currentLandValue: 6000,
          currentImprovementValue: 30000,
          currentMarketValue: 360000,
        },
      },
    ])
    for (const other of [dryRun, preview, armed]) expect(other).toEqual(disabled)
  })

  const decidedAppeal = () => ({
    id: "appeal_1",
    taxYear: 2026,
    originalAssessmentValue: 40000,
    requestedAssessmentValue: null,
  })

  it("still sends the appeal-decision email when the increase email is disabled", async () => {
    openAppeals = [decidedAppeal()]
    const [r] = await runAssessmentChecks()
    expect(r.increaseEmail).toBe("disabled")
    expect(prismaMock.appeal.update).toHaveBeenCalledTimes(1)
    expect(decisionEmails()).toHaveLength(1)
    expect(increaseEmails()).toHaveLength(0)
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it("still sends the appeal-decision email on a Preview deployment", async () => {
    arm({ VERCEL_ENV: "preview" })
    jest.spyOn(console, "info").mockImplementation(() => {})
    openAppeals = [decidedAppeal()]
    await runAssessmentChecks()
    expect(decisionEmails()).toHaveLength(1)
    expect(increaseEmails()).toHaveLength(0)
  })

  it("sends both emails, once each, when fully armed", async () => {
    arm()
    openAppeals = [decidedAppeal()]
    await runAssessmentChecks()
    expect(decisionEmails()).toHaveLength(1)
    expect(increaseEmails()).toHaveLength(1)
    expect(sendEmail).toHaveBeenCalledTimes(2)
  })
})
