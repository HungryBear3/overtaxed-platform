/** @jest-environment node */

jest.mock("stripe", () => ({
  __esModule: true,
  default: jest.fn(() => {
    throw new Error("Stripe constructor must not run during route import")
  }),
}))

jest.mock("@/lib/db", () => ({ prisma: { oTOrder: {} } }))
jest.mock("@/lib/cook-county", () => ({
  getPropertyByPIN: jest.fn(),
  normalizePIN: (value: string) => value.replace(/\D/g, ""),
  searchPropertiesByAddress: jest.fn(),
}))
jest.mock("@/lib/free-check-appeal-window", () => ({ getFreeCheckAppealWindowStatus: jest.fn() }))
jest.mock("@/lib/rate-limit", () => ({ getClientIdentifier: jest.fn(), rateLimit: jest.fn() }))
jest.mock("@/lib/marketing/preview-gate", () => ({
  hostFromRequest: jest.fn(),
  isPreviewStubEnabled: jest.fn(),
  marketingGateReason: jest.fn(),
  previewNoopResponseBody: jest.fn(),
}))

describe("checkout route build-time import safety", () => {
  it("does not construct Stripe while the route module is imported without secrets", () => {
    const prior = process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_SECRET_KEY
    try {
      expect(() => jest.isolateModules(() => require("@/app/api/checkout/session/route"))).not.toThrow()
    } finally {
      if (prior === undefined) delete process.env.STRIPE_SECRET_KEY
      else process.env.STRIPE_SECRET_KEY = prior
    }
  })
})
