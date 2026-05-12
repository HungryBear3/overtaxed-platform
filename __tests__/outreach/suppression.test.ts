/** Suppression helper: duplicate-safe behavior under DB uniqueness enforcement. */

const suppressions: Array<Record<string, unknown>> = []

jest.mock("@/lib/db", () => ({
  prisma: {
    outreachSuppression: {
      create: jest.fn(async ({ data }: any) => {
        const exists = suppressions.find(
          (row) =>
            row.emailLowercase === data.emailLowercase &&
            (row.campaignId ?? null) === (data.campaignId ?? null) &&
            row.reason === data.reason,
        )
        if (exists) {
          const err = new Error("Unique constraint failed") as Error & { code?: string }
          err.code = "P2002"
          throw err
        }
        suppressions.push({ id: `sp_${suppressions.length + 1}`, ...data })
        return data
      }),
      findFirst: jest.fn(async () => null),
    },
    outreachSend: {
      count: jest.fn(async () => 0),
    },
  },
}))

import { addSuppression } from "@/lib/outreach/suppression"

beforeEach(() => {
  suppressions.length = 0
})

describe("addSuppression", () => {
  it("returns duplicate instead of throwing on equivalent duplicate inserts", async () => {
    const args = {
      email: "Board@example.com",
      reason: "COMPLAINED" as const,
      source: "webhook" as const,
      campaignId: null,
      note: "first",
    }

    await expect(addSuppression(args)).resolves.toBe("inserted")
    await expect(addSuppression(args)).resolves.toBe("duplicate")
    expect(suppressions).toHaveLength(1)
  })
})
