/** @jest-environment node */

import { sendGaPurchaseEvent } from "@/lib/analytics/ga4-measurement"
import type { GaMeasurementResult } from "@/lib/analytics/ga4-measurement"
import type { GaPurchaseClaim } from "@/lib/analytics/ga4-purchase-claim"

const PURCHASE = {
  host: "www.overtaxed-il.com",
  amountCents: 9700,
  currency: "usd",
  itemName: "T3",
  itemCategory: "ot_checkout",
  itemVariant: "T3",
  transactionId: "cs_test_123",
  anonymousIds: { gaClientId: "1234567890.1234567890" },
}

const won = async (): Promise<GaPurchaseClaim> => "won"

describe("sendGaPurchaseEvent", () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = "production"
    process.env.VERCEL_ENV = "production"
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-TEST123"
    process.env.GA4_API_SECRET = "ga4_secret"
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it("contains fetch exceptions and returns a redacted provider_error result", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("socket hangup ga4_secret buyer@example.com")
    }) as unknown as typeof fetch

    await expect(sendGaPurchaseEvent(PURCHASE, won)).resolves.toEqual({
      ok: false,
      code: "provider_error",
      status: 0,
    })
  })

  it("aborts a stalled Measurement Protocol request after a short timeout", async () => {
    jest.useFakeTimers()

    let settled: GaMeasurementResult | undefined
    global.fetch = jest.fn((_input, init) => new Promise((_, reject) => {
      const signal = init?.signal as AbortSignal | undefined
      signal?.addEventListener(
        "abort",
        () => reject(Object.assign(new Error("aborted ga4_secret buyer@example.com"), { name: "AbortError" })),
        { once: true },
      )
    })) as unknown as typeof fetch

    const resultPromise = sendGaPurchaseEvent(
      { ...PURCHASE, itemName: "T2", itemVariant: "T2", transactionId: "cs_test_timeout" },
      won,
    ).then((result) => {
      settled = result
      return result
    })

    await jest.advanceTimersByTimeAsync(2000)
    await Promise.resolve()

    expect(settled).toEqual({
      ok: false,
      code: "provider_error",
      status: 0,
    })
    await expect(resultPromise).resolves.toEqual({
      ok: false,
      code: "provider_error",
      status: 0,
    })
  })

  it.each([
    ["preview runtime", "preview", "www.overtaxed-il.com"],
    ["noncanonical host", "production", "ot-preview.vercel.app"],
  ])("refuses Measurement Protocol delivery in %s", async (_label, vercelEnv, host) => {
    process.env.VERCEL_ENV = vercelEnv
    global.fetch = jest.fn() as unknown as typeof fetch

    await expect(sendGaPurchaseEvent({ ...PURCHASE, host, transactionId: "cs_test_gated" }, won)).resolves.toEqual({
      ok: true,
      code: "skipped_non_production",
    })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

/**
 * At most one transport per transaction: the caller's durable claim is taken
 * only when a send would otherwise happen, and a send happens only for the
 * claim's winner. Provider failure after the claim is not retried, so a
 * purchase can go missing from GA but can never be sent twice.
 */
describe("durable purchase ownership", () => {
  const originalFetch = global.fetch
  let fetchSpy: jest.Mock

  beforeEach(() => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = "production"
    process.env.VERCEL_ENV = "production"
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-TEST123"
    process.env.GA4_API_SECRET = "ga4_secret"
    fetchSpy = jest.fn(async () => ({ ok: true, status: 204 }))
    global.fetch = fetchSpy as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it("claims ownership first and then transmits once", async () => {
    const order: string[] = []
    fetchSpy.mockImplementation(async () => {
      order.push("transmit")
      return { ok: true, status: 204 }
    })
    const claim = jest.fn(async (): Promise<GaPurchaseClaim> => {
      order.push("claim")
      return "won"
    })

    await expect(sendGaPurchaseEvent(PURCHASE, claim)).resolves.toEqual({ ok: true, code: "sent" })
    expect(order).toEqual(["claim", "transmit"])
  })

  it("transmits nothing when another delivery already owns the purchase", async () => {
    await expect(sendGaPurchaseEvent(PURCHASE, async () => "already_claimed")).resolves.toEqual({
      ok: true,
      code: "skipped_already_claimed",
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each([
    ["reports it could not record the claim", async (): Promise<GaPurchaseClaim> => "unavailable"],
    [
      "throws",
      async (): Promise<GaPurchaseClaim> => {
        throw new Error("claim store down buyer@example.com")
      },
    ],
  ])("transmits nothing when the claim store %s", async (_label, claim) => {
    await expect(sendGaPurchaseEvent(PURCHASE, claim)).resolves.toEqual({ ok: false, code: "claim_unavailable" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each([
    ["a transaction id that is not a Checkout Session id", { transactionId: "ord_t2" }],
    ["a PaymentIntent as the transaction id", { transactionId: "pi_3Nabcdefghijklmn" }],
    ["a tier outside the contract", { itemName: "T9", itemVariant: "T9" }],
    ["a currency other than USD", { currency: "eur" }],
    ["an implausible amount", { amountCents: 2_000_000 }],
  ])("refuses a body the purchase contract rejects — %s — without claiming or transmitting", async (_label, change) => {
    const claim = jest.fn(won)

    await expect(sendGaPurchaseEvent({ ...PURCHASE, ...change }, claim)).resolves.toEqual({
      ok: false,
      code: "refused_contract",
    })
    expect(claim).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each([
    ["in a preview runtime", () => { process.env.VERCEL_ENV = "preview" }, {}, "skipped_non_production"],
    ["without an API secret", () => { process.env.GA4_API_SECRET = "" }, {}, "skipped_missing_config"],
    ["without a GA client id", () => undefined, { anonymousIds: {} }, "skipped_missing_client_id"],
  ])("does not claim ownership %s", async (_label, arrange, change, code) => {
    arrange()
    const claim = jest.fn(won)

    await expect(sendGaPurchaseEvent({ ...PURCHASE, ...change }, claim)).resolves.toEqual({ ok: true, code })
    expect(claim).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
