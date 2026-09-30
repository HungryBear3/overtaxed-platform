/**
 * GET /partner/[code] is a public page. Rendering it must never create a
 * referral: an unknown or malformed code is a 404, and only a referral an
 * admin already issued renders its dashboard.
 */
import { render, screen } from "@testing-library/react"

const NOT_FOUND = new Error("NEXT_NOT_FOUND")
jest.mock("next/navigation", () => ({
  notFound: () => {
    throw NOT_FOUND
  },
}))

const referral = {
  upsert: jest.fn(),
  create: jest.fn(),
  findUnique: jest.fn(async ({ where }: { where: { code: string } }) =>
    where.code === "john"
      ? {
          code: "john",
          name: "John Grafft",
          visits: 10,
          conversions: 1,
          revenue: 99,
          commissionRate: 0.5,
        }
      : null,
  ),
}
jest.mock("@/lib/db", () => ({
  prisma: {
    get referral() {
      return referral
    },
  },
}))

import PartnerDashboardPage from "@/app/partner/[code]/page"

function page(code: string) {
  return PartnerDashboardPage({ params: Promise.resolve({ code }) })
}

beforeEach(() => jest.clearAllMocks())
afterEach(() => {
  expect(referral.upsert).not.toHaveBeenCalled()
  expect(referral.create).not.toHaveBeenCalled()
})

describe("/partner/[code]", () => {
  it("renders the dashboard for an existing canonical code", async () => {
    render(await page("john"))
    expect(referral.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { code: "john" } }))
    expect(screen.getByText("Welcome, John Grafft")).toBeTruthy()
  })

  it("looks up the canonical form of a differently cased code", async () => {
    render(await page("JOHN"))
    expect(referral.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { code: "john" } }))
  })

  it("is a 404 for an unknown well-formed code and creates nothing", async () => {
    await expect(page("attacker-code")).rejects.toBe(NOT_FOUND)
  })

  it.each([
    ["an email", "owner@example.com"],
    ["a name", "John Smith"],
    ["a confusable", "jоhn"],
    ["a control character", "john\u0000"],
    ["an oversized value", "a".repeat(500)],
  ])("is a 404 for %s without a database lookup", async (_label, code) => {
    await expect(page(code)).rejects.toBe(NOT_FOUND)
    expect(referral.findUnique).not.toHaveBeenCalled()
  })

  it("never renders a raw database error", async () => {
    referral.findUnique.mockRejectedValueOnce(new Error("connection string postgres://secret"))
    const result = await page("john").then(
      (element) => element,
      (err) => err,
    )
    if (result === NOT_FOUND) return
    expect(result).not.toBeInstanceOf(Error)
    const { container } = render(result)
    expect(container.textContent).not.toContain("postgres://secret")
  })
})
