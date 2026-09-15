/**
 * @jest-environment node
 *
 * The real provider adapter, driven with a FAKE provider. No credential, no
 * network, and no message leaves this process.
 *
 * The properties under test:
 *   - it refuses to exist at all without complete, validated configuration;
 *   - the capability travels as a CODE in the body and never as a URL;
 *   - a definite rejection revokes the unsent code; an ambiguous one never does;
 *   - an attempt that already minted a code is never re-minted under the same
 *     key, and that case reports UNKNOWN rather than "not sent".
 */
import type { DeliverySendOutcome } from "@/lib/fulfillment/delivery-orchestration"
import {
  buildPacketHandoffMessage,
  createT2ResendAdapter,
  resolveT2ResendAdapterConfig,
  type T2MailProvider,
  type T2SendContext,
  type T2SendContextReader,
} from "@/lib/fulfillment-runtime/t2-resend-adapter"

jest.mock("server-only", () => ({}))

const ORDER_ID = "ord_paid_t2"
const FULFILLMENT_ID = "ful_t2"
const SHA = "a".repeat(64)
const CODE = "Zm9vYmFyYmF6cXV1eGNvcmdlZ3JhdWx0Z2FycGx5Z2g"
const KEY = "otf:v1:purpose=DELIVERY:kind=T2_APPEAL_EVIDENCE:order=present.10~ord_paid_t2:tier=T2:attempt=1:sha=" + SHA

const ENV = {
  OT_T2_DELIVERY_ADAPTER_ENABLED: "true",
  OT_T2_PACKET_DOWNLOAD_ENABLED: "true",
  RESEND_API_KEY: "re_test_key_not_a_real_credential",
  OT_T2_DELIVERY_FROM: "OverTaxed IL <support@overtaxed-il.com>",
  NEXT_PUBLIC_APP_URL: "https://www.overtaxed-il.com",
}

const SEND = {
  orderId: ORDER_ID,
  fulfillmentId: FULFILLMENT_ID,
  attemptNumber: 1,
  artifactVersion: 1,
  artifactSha256: SHA,
  idempotencyKey: KEY,
}

function context(patch: Partial<T2SendContext> = {}): T2SendContext {
  return {
    recipient: "owner@example.com",
    orderStatus: "PAID",
    orderTier: "T2",
    fulfillmentOrderId: ORDER_ID,
    fulfillmentKind: "T2_APPEAL_EVIDENCE",
    fulfillmentStatus: "DELIVERY_PENDING",
    attemptCount: 1,
    currentArtifactVersion: 1,
    currentArtifactSha256: SHA,
    attemptProvider: "resend",
    attemptIdempotencyKey: KEY,
    attemptCapabilityId: null,
    ...patch,
  }
}

type Harness = {
  sent: Array<{ message: Record<string, string>; idempotencyKey: string }>
  issued: unknown[]
  revoked: unknown[]
  send(patch?: Partial<T2SendContext>): Promise<DeliverySendOutcome>
}

function harness(
  options: {
    response?: { id: string | null; errorName: string | null }
    throws?: boolean
    hangs?: boolean
    issuanceBlocker?: string
  } = {},
): Harness {
  const sent: Harness["sent"] = []
  const issued: unknown[] = []
  const revoked: unknown[] = []
  let current = context()

  const provider: T2MailProvider = {
    async send(message, opts) {
      sent.push({ message: message as unknown as Record<string, string>, idempotencyKey: opts.idempotencyKey })
      if (options.throws) throw new Error("synthetic provider failure")
      if (options.hangs) return new Promise(() => {})
      return options.response ?? { id: "msg_provider_accepted", errorName: null }
    },
  }
  const reader: T2SendContextReader = { async load() { return current } }
  const issue = (async (input: unknown) => {
    issued.push(input)
    if (options.issuanceBlocker)
      return { ok: false, blocker: options.issuanceBlocker }
    return {
      ok: true,
      issuance: {
        value: CODE,
        capabilityId: "cap_1",
        artifactSha256: SHA,
        expiresAt: "2026-09-19T12:00:00.000Z",
        maxUses: 5,
      },
    }
  }) as never

  const adapter = createT2ResendAdapter({
    env: ENV,
    provider,
    reader,
    issue,
    revoke: async (input) => {
      revoked.push(input)
      return { ok: true, revoked: 1 }
    },
    timeoutMs: 25,
  })
  if (!adapter) throw new Error("adapter should construct with complete config")

  return {
    sent,
    issued,
    revoked,
    async send(patch = {}) {
      current = context(patch)
      return adapter.send(SEND)
    },
  }
}

describe("the adapter refuses to exist without complete configuration", () => {
  it("resolves a complete configuration", () => {
    expect(resolveT2ResendAdapterConfig(ENV)).toEqual({
      ok: true,
      config: {
        apiKey: ENV.RESEND_API_KEY,
        from: ENV.OT_T2_DELIVERY_FROM,
        appOrigin: "https://www.overtaxed-il.com",
      },
    })
  })

  it.each([
    ["OT_T2_DELIVERY_ADAPTER_ENABLED", { OT_T2_DELIVERY_ADAPTER_ENABLED: undefined }],
    ["OT_T2_DELIVERY_ADAPTER_ENABLED", { OT_T2_DELIVERY_ADAPTER_ENABLED: "TRUE" }],
    ["OT_T2_PACKET_DOWNLOAD_ENABLED", { OT_T2_PACKET_DOWNLOAD_ENABLED: undefined }],
    ["RESEND_API_KEY", { RESEND_API_KEY: undefined }],
    ["RESEND_API_KEY", { RESEND_API_KEY: "short" }],
    ["OT_T2_DELIVERY_FROM", { OT_T2_DELIVERY_FROM: undefined, RESEND_FROM: undefined }],
    ["OT_T2_DELIVERY_FROM", { OT_T2_DELIVERY_FROM: "not an address" }],
    ["OT_T2_DELIVERY_FROM", { OT_T2_DELIVERY_FROM: "a@b.com\nBcc: victim@example.com" }],
    ["NEXT_PUBLIC_APP_URL", { NEXT_PUBLIC_APP_URL: undefined }],
    ["NEXT_PUBLIC_APP_URL", { NEXT_PUBLIC_APP_URL: "http://insecure.example.com" }],
    ["NEXT_PUBLIC_APP_URL", { NEXT_PUBLIC_APP_URL: "https://evil.example.com/path?x=1" }],
  ])("names %s as missing", (missing, patch) => {
    expect(resolveT2ResendAdapterConfig({ ...ENV, ...patch })).toEqual({ ok: false, missing })
  })

  it("never returns an adapter under incomplete configuration", () => {
    expect(createT2ResendAdapter({ env: { ...ENV, RESEND_API_KEY: undefined } })).toBeNull()
    // With no adapter the delivery orchestrator makes zero writes, so an
    // unconfigured deployment cannot manufacture a failed delivery record.
  })

  it("falls back to the existing transactional sender identity", () => {
    const resolved = resolveT2ResendAdapterConfig({
      ...ENV,
      OT_T2_DELIVERY_FROM: undefined,
      RESEND_FROM: "OverTaxed IL <support@overtaxed-il.com>",
    })
    expect(resolved).toMatchObject({ ok: true })
  })

  it("never echoes the API key in a refusal", () => {
    const refusal = resolveT2ResendAdapterConfig({ ...ENV, OT_T2_DELIVERY_FROM: "bad" })
    expect(JSON.stringify(refusal)).not.toContain(ENV.RESEND_API_KEY)
  })
})

describe("the code travels in the body, never in a URL", () => {
  const message = buildPacketHandoffMessage({
    appOrigin: "https://www.overtaxed-il.com",
    code: CODE,
    expiresAt: "2026-09-19T12:00:00.000Z",
  })

  it("links a generic /packet page with no token, query or fragment", () => {
    expect(message.text).toContain("https://www.overtaxed-il.com/packet")
    expect(message.html).toContain('href="https://www.overtaxed-il.com/packet"')
    for (const body of [message.text, message.html]) {
      // Every URL in the message is exactly the generic one.
      const urls = body.match(/https?:\/\/[^\s"<>]+/g) ?? []
      expect(urls.length).toBeGreaterThan(0)
      for (const url of urls) {
        expect(url).toBe("https://www.overtaxed-il.com/packet")
        expect(url).not.toContain(CODE)
        expect(url).not.toContain("?")
        expect(url).not.toContain("#")
      }
    }
  })

  it("carries no order, fulfillment or attempt identifier", () => {
    for (const body of [message.text, message.html, message.subject]) {
      expect(body).not.toContain(ORDER_ID)
      expect(body).not.toContain(FULFILLMENT_ID)
      expect(body).not.toContain(SHA)
    }
  })

  it("prints the code as plain text so no client turns it into a link", () => {
    expect(message.text).toContain(`\n${CODE}\n`)
    expect(message.html).toContain(`>${CODE}<`)
  })

  it("escapes anything interpolated into the HTML body", () => {
    const hostile = buildPacketHandoffMessage({
      appOrigin: "https://www.overtaxed-il.com",
      code: '"><script>alert(1)</script>',
      expiresAt: "2026-09-19T12:00:00.000Z",
    })
    expect(hostile.html).not.toContain("<script>")
    expect(hostile.html).toContain("&lt;script&gt;")
  })
})

describe("outcomes are reported honestly", () => {
  it("reports ACCEPTED with the provider message id, and never DELIVERED", async () => {
    const h = harness()
    await expect(h.send()).resolves.toEqual({
      kind: "ACCEPTED",
      provider: "resend",
      providerMessageId: "msg_provider_accepted",
    })
    expect(h.sent).toHaveLength(1)
    // The durable delivery key is handed to the provider, so its own retry of
    // this exact logical send cannot produce a second message.
    expect(h.sent[0].idempotencyKey).toBe(KEY)
    expect(h.revoked).toEqual([])
  })

  it("never returns the capability value to its caller", async () => {
    const h = harness()
    const outcome = await h.send()
    expect(JSON.stringify(outcome)).not.toContain(CODE)
  })

  it("sends to the address on the authoritative order, never a supplied one", async () => {
    const h = harness()
    await h.send({ recipient: "designated@example.com" })
    expect(h.sent[0].message.to).toBe("designated@example.com")
  })

  it.each([
    ["a definite validation error", "validation_error", "MANUAL_REVIEW"],
    ["a suppressed recipient", "suppressed_recipient", "INVALID_RECIPIENT"],
    ["a quota refusal", "daily_quota_exceeded", "RATE_LIMITED"],
    ["a rejected credential", "invalid_api_Key", "MANUAL_REVIEW"],
  ])("treats %s as REJECTED and revokes the unsent code", async (_label, errorName, reasonCode) => {
    const h = harness({ response: { id: null, errorName } })
    await expect(h.send()).resolves.toEqual({
      kind: "REJECTED",
      provider: "resend",
      reasonCode,
    })
    expect(h.revoked).toEqual([
      { fulfillmentId: FULFILLMENT_ID, reasonCode: "SEND_REJECTED" },
    ])
  })

  it.each([
    ["an unrecognized error name", { response: { id: null, errorName: "internal_server_error" } }],
    ["an error name nobody has seen", { response: { id: null, errorName: "brand_new_failure" } }],
    ["a response with neither id nor error", { response: { id: null, errorName: null } }],
    ["a thrown call", { throws: true }],
    ["a call that never returns", { hangs: true }],
  ])("treats %s as UNKNOWN and revokes nothing", async (_label, options) => {
    const h = harness(options)
    await expect(h.send()).resolves.toEqual({ kind: "UNKNOWN", provider: "resend" })
    // The mail may be in flight, so the code stays live — the holder may yet
    // receive it, and claiming "not sent" here could authorize a duplicate.
    expect(h.revoked).toEqual([])
  })
})

describe("authority is re-verified against freshly read state", () => {
  it.each([
    ["a refunded order", { orderStatus: "REFUNDED" }],
    ["a non-T2 order", { orderTier: "T3" }],
    ["a foreign fulfillment", { fulfillmentOrderId: "ord_other" }],
    ["a foreign kind", { fulfillmentKind: "OTHER" }],
    ["a fulfillment with no send in flight", { fulfillmentStatus: "ARTIFACT_READY" }],
    ["a superseded attempt", { attemptCount: 2 }],
    ["another provider's attempt", { attemptProvider: "postmark" }],
    ["a different idempotency key", { attemptIdempotencyKey: "otf:v1:something-else" }],
    ["a newer artifact version", { currentArtifactVersion: 2 }],
    ["a different artifact digest", { currentArtifactSha256: "b".repeat(64) }],
  ])("refuses %s before minting or sending", async (_label, patch) => {
    const h = harness()
    await expect(h.send(patch)).resolves.toEqual({
      kind: "REJECTED",
      provider: "resend",
      reasonCode: "MANUAL_REVIEW",
    })
    expect(h.issued).toEqual([])
    expect(h.sent).toEqual([])
  })

  it.each(["", "   ", "not-an-address", "a@b", "two@addr.com, other@addr.com", "a@b.com\nBcc: x@y.com"])(
    "refuses the malformed recipient %j before minting or sending",
    async (recipient) => {
      const h = harness()
      await expect(h.send({ recipient })).resolves.toEqual({
        kind: "REJECTED",
        provider: "resend",
        reasonCode: "INVALID_RECIPIENT",
      })
      expect(h.issued).toEqual([])
      expect(h.sent).toEqual([])
    },
  )

  it("refuses when the adapter flag is withdrawn between injection and send", async () => {
    const adapter = createT2ResendAdapter({
      env: ENV,
      // Construction succeeds, then the environment the send re-reads is shut.
      config: { apiKey: "x".repeat(16), from: ENV.OT_T2_DELIVERY_FROM, appOrigin: "https://www.overtaxed-il.com" },
      provider: { async send() { throw new Error("must not be called") } },
      reader: { async load() { return context() } },
    })
    expect(adapter).not.toBeNull()
    const shut = createT2ResendAdapter({
      env: { ...ENV, OT_T2_DELIVERY_ADAPTER_ENABLED: "false" },
      config: { apiKey: "x".repeat(16), from: ENV.OT_T2_DELIVERY_FROM, appOrigin: "https://www.overtaxed-il.com" },
      provider: { async send() { throw new Error("must not be called") } },
      reader: { async load() { return context() } },
    })
    await expect(shut!.send(SEND)).resolves.toEqual({
      kind: "REJECTED",
      provider: "resend",
      reasonCode: "MANUAL_REVIEW",
    })
  })
})

describe("an ambiguous send is never re-minted under the same key", () => {
  it("reports UNKNOWN when the attempt already owns a capability", async () => {
    const h = harness()
    await expect(h.send({ attemptCapabilityId: "cap_already_issued" })).resolves.toEqual({
      kind: "UNKNOWN",
      provider: "resend",
    })
    expect(h.issued).toEqual([])
    expect(h.sent).toEqual([])
  })

  it("reports UNKNOWN when the store refuses the binding to a concurrent issuer", async () => {
    const h = harness({ issuanceBlocker: "CAPABILITY_BINDING_MISMATCH" })
    await expect(h.send()).resolves.toEqual({ kind: "UNKNOWN", provider: "resend" })
    expect(h.sent).toEqual([])
  })

  it("reports REJECTED for an issuance refusal that is definite", async () => {
    const h = harness({ issuanceBlocker: "ORDER_NOT_ELIGIBLE" })
    await expect(h.send()).resolves.toEqual({
      kind: "REJECTED",
      provider: "resend",
      reasonCode: "MANUAL_REVIEW",
    })
    expect(h.sent).toEqual([])
  })

  it("mints against the exact attempt and provider", async () => {
    const h = harness()
    await h.send()
    expect(h.issued).toEqual([
      { fulfillmentId: FULFILLMENT_ID, attemptNumber: 1, provider: "resend" },
    ])
  })
})
