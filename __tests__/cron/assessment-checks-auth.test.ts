/** @jest-environment node */

const runAssessmentChecks = jest.fn(async () => [
  {
    propertyId: "prop_1",
    pin: "10-25-107-045-0000",
    updated: true,
    newYears: [2025],
    increaseDetected: false,
    error: null,
  },
])

jest.mock("@/lib/monitoring/assessment-check", () => ({ runAssessmentChecks }))

import { NextRequest } from "next/server"

const SECRET = "assessment-cron-secret"
const URL = "http://localhost/api/cron/assessment-checks"

function request(headers: Record<string, string> = {}) {
  return new NextRequest(URL, { method: "GET", headers })
}

async function run(headers: Record<string, string> = {}) {
  const { GET } = await import("@/app/api/cron/assessment-checks/route")
  const response = await GET(request(headers))
  return { response, json: await response.json() }
}

describe("/api/cron/assessment-checks authorization", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.CRON_SECRET = SECRET
  })

  afterAll(() => delete process.env.CRON_SECRET)

  it("fails closed before any assessment work when CRON_SECRET is absent", async () => {
    delete process.env.CRON_SECRET
    const { response, json } = await run()
    expect(response.status).toBe(401)
    expect(json).toEqual({ error: "Unauthorized" })
    expect(runAssessmentChecks).not.toHaveBeenCalled()
  })

  it("fails closed before any assessment work on a wrong bearer", async () => {
    const { response } = await run({ authorization: "Bearer wrong" })
    expect(response.status).toBe(401)
    expect(runAssessmentChecks).not.toHaveBeenCalled()
  })

  it("runs only with the exact configured bearer", async () => {
    const { response, json } = await run({ authorization: `Bearer ${SECRET}` })
    expect(response.status).toBe(200)
    expect(runAssessmentChecks).toHaveBeenCalledTimes(1)
    expect(json).toMatchObject({ success: true, propertiesChecked: 1, updated: 1 })
  })
})
