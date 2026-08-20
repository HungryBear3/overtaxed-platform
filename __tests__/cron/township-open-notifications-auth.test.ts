/** @jest-environment node */

const findMany = jest.fn(async () => [
  {
    id: "prop_1",
    pin: "10-25-107-045-0000",
    address: "123 Main St",
    city: "Evanston",
    state: "IL",
    township: "Evanston",
    appeals: [],
    user: { id: "user_1", email: "owner@example.com", name: "Owner" },
  },
])
const sendEmail = jest.fn(async () => true)
const townshipOpenNotificationTemplate = jest.fn(() => ({
  subject: "Window opened",
  text: "Window opened",
  html: "<p>Window opened</p>",
}))
const describeTownshipCalendar = jest.fn(() => ({
  available: true,
  allowDeadlineEmail: true,
  status: "open",
  openDate: "2026-08-20",
  noticeDate: "2026-08-20",
  lastFileDate: "2026-09-20",
}))

jest.mock("@/lib/db", () => ({ prisma: { property: { findMany } } }))
jest.mock("@/lib/email", () => ({ sendEmail, townshipOpenNotificationTemplate }))
jest.mock("@/lib/cook-county", () => ({ formatPIN: (pin: string) => pin }))
jest.mock("@/lib/appeals/township-deadlines", () => ({
  ASSESSOR_CALENDAR_URL: "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines",
  OFFICIAL_DEADLINE_SNAPSHOT: {
    townships: { evanston: { townshipName: "Evanston" } },
  },
  describeTownshipCalendar,
}))
jest.mock("@/lib/monitoring/schedule", () => ({
  normalizeTownshipForMatch: (value: string | null) => value?.toLowerCase() ?? null,
}))

import { NextRequest } from "next/server"

const SECRET = "township-cron-secret"
const URL = "http://localhost/api/cron/township-open-notifications"

function request(headers: Record<string, string> = {}) {
  return new NextRequest(URL, { method: "GET", headers })
}

async function run(headers: Record<string, string> = {}) {
  const { GET } = await import("@/app/api/cron/township-open-notifications/route")
  const response = await GET(request(headers))
  return { response, json: await response.json() }
}

describe("/api/cron/township-open-notifications authorization", () => {
  beforeAll(() => jest.useFakeTimers().setSystemTime(new Date("2026-08-20T12:00:00Z")))

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.CRON_SECRET = SECRET
    process.env.NEXT_PUBLIC_APP_URL = "https://www.overtaxed-il.com"
  })

  afterAll(() => {
    jest.useRealTimers()
    delete process.env.CRON_SECRET
  })

  it("fails closed before calendar, database, or email work when CRON_SECRET is absent", async () => {
    delete process.env.CRON_SECRET
    const { response, json } = await run()
    expect(response.status).toBe(401)
    expect(json).toEqual({ error: "Unauthorized" })
    expect(describeTownshipCalendar).not.toHaveBeenCalled()
    expect(findMany).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("fails closed before reads or sends on a wrong bearer", async () => {
    const { response } = await run({ authorization: "Bearer wrong" })
    expect(response.status).toBe(401)
    expect(findMany).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("permits the verified-opening workflow only with the exact configured bearer", async () => {
    const { response, json } = await run({ authorization: `Bearer ${SECRET}` })
    expect(response.status).toBe(200)
    expect(describeTownshipCalendar).toHaveBeenCalledTimes(1)
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(json).toEqual({ success: true, emailsSent: 1 })
  })
})
