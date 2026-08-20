/** @jest-environment node */

import { sendGaPurchaseEvent } from "@/lib/analytics/ga4-measurement"
import type { GaMeasurementResult } from "@/lib/analytics/ga4-measurement"

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

    await expect(sendGaPurchaseEvent({
      host: "www.overtaxed-il.com",
      amountCents: 9700,
      currency: "usd",
      itemName: "T3",
      itemCategory: "ot_checkout",
      itemVariant: "T3",
      transactionId: "cs_test_123",
      anonymousIds: { gaClientId: "1234567890.1234567890" },
    })).resolves.toEqual({
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

    const resultPromise = sendGaPurchaseEvent({
      host: "www.overtaxed-il.com",
      amountCents: 9700,
      currency: "usd",
      itemName: "T2",
      itemCategory: "ot_checkout",
      itemVariant: "T2",
      transactionId: "cs_test_timeout",
      anonymousIds: { gaClientId: "1234567890.1234567890" },
    }).then((result) => {
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

    await expect(sendGaPurchaseEvent({
      host,
      amountCents: 9700,
      currency: "usd",
      itemName: "T3",
      itemCategory: "ot_checkout",
      itemVariant: "T3",
      transactionId: "cs_test_gated",
      anonymousIds: { gaClientId: "1234567890.1234567890" },
    })).resolves.toEqual({ ok: true, code: "skipped_non_production" })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
