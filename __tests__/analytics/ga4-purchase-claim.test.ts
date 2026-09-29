/** @jest-environment node */

/**
 * Durable, winner-only ownership of a transaction's one GA4 purchase send.
 *
 * The claim is a row in the webhook's existing idempotency table, whose
 * primary key is unique, so it survives the release of a Stripe event claim,
 * a redelivery and a different event for the same Checkout Session. The store
 * below is that table's contract: a unique key, P2002 on a duplicate insert.
 */
import { claimGaPurchaseTransport } from "@/lib/analytics/ga4-purchase-claim"

type Row = { id: string; type: string }

function uniqueKeyTable(failure?: Error) {
  const rows = new Map<string, Row>()
  return {
    rows,
    stripeEvent: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        if (failure) throw failure
        if (rows.has(data.id)) throw Object.assign(new Error("Unique constraint failed on the fields: (`id`)"), { code: "P2002" })
        rows.set(data.id, { ...data })
        return data
      }),
    },
  }
}

describe("claimGaPurchaseTransport", () => {
  it("lets exactly one claimant own a transaction, whichever event it arrives with", async () => {
    const store = uniqueKeyTable()

    await expect(claimGaPurchaseTransport(store, "cs_test_a")).resolves.toBe("won")
    await expect(claimGaPurchaseTransport(store, "cs_test_a")).resolves.toBe("already_claimed")
    await expect(claimGaPurchaseTransport(store, "cs_test_b")).resolves.toBe("won")
  })

  it("decides concurrent claimants for one transaction by the unique key", async () => {
    const store = uniqueKeyTable()

    const results = await Promise.all([
      claimGaPurchaseTransport(store, "cs_test_a"),
      claimGaPurchaseTransport(store, "cs_test_a"),
    ])

    expect(results.sort()).toEqual(["already_claimed", "won"])
  })

  it("never occupies a key a Stripe event could have, so it can neither block nor be released as one", async () => {
    const store = uniqueKeyTable()
    store.rows.set("evt_1NabcdEFGH", { id: "evt_1NabcdEFGH", type: "checkout.session.completed" })

    await expect(claimGaPurchaseTransport(store, "cs_test_a")).resolves.toBe("won")

    const claims = Array.from(store.rows.values()).filter((row) => row.id !== "evt_1NabcdEFGH")
    expect(claims).toHaveLength(1)
    expect(claims[0].id.startsWith("evt_")).toBe(false)
    expect(claims[0].id).toContain("cs_test_a")
  })

  it("reports a store that cannot record the claim as unavailable, not as won", async () => {
    const store = uniqueKeyTable(Object.assign(new Error("Can't reach database server"), { code: "P1001" }))

    await expect(claimGaPurchaseTransport(store, "cs_test_a")).resolves.toBe("unavailable")
  })
})
