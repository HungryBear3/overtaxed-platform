/**
 * @jest-environment node
 *
 * Signature verification for paid-packet provider callbacks, exercised against
 * REAL Svix signatures rather than a stubbed verifier.
 *
 * This endpoint is deliberately stricter than the outreach one next to it. That
 * verifier permits an absent secret outside production and carries a legacy raw
 * HMAC fallback, which is a defensible posture for campaign telemetry and an
 * unacceptable one for evidence about a paid order. Every assertion here is
 * about a way in that must NOT exist.
 */
import { Webhook as SvixWebhook } from "svix"
import {
  getT2CallbackSecret,
  ingestT2ResendCallback,
  MAX_SIGNATURE_AGE_MS,
} from "@/lib/fulfillment-runtime/t2-resend-events"
import type { ProviderCallbackStore } from "@/lib/fulfillment-runtime/provider-callback-store"

jest.mock("server-only", () => ({}))

// A syntactically valid Svix secret. Test-only, never a real credential.
const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"
// Anchored to the real clock on purpose. Svix applies its OWN tolerance against
// wall-clock time inside `verify`, so a fixed past instant would make every
// "correctly signed" case fail for the wrong reason and quietly stop proving
// anything. The service's independent staleness check is driven by the injected
// `now`, which is this same instant.
const NOW = new Date()
const OCCURRED_AT = new Date(NOW.getTime() - 30_000).toISOString()
const MESSAGE_ID = "b7e2e2c0-0000-4000-8000-000000000001"

const payload = JSON.stringify({
  type: "email.delivered",
  created_at: OCCURRED_AT,
  data: { email_id: MESSAGE_ID, to: ["owner@example.com"] },
})

function signed(
  options: { id?: string; at?: Date; body?: string; secret?: string } = {},
) {
  const id = options.id ?? "msg_2signed_envelope"
  const at = options.at ?? NOW
  const body = options.body ?? payload
  const signature = new SvixWebhook(options.secret ?? SECRET).sign(id, at, body)
  return {
    rawBody: body,
    headers: {
      "svix-id": id,
      "svix-timestamp": String(Math.floor(at.getTime() / 1000)),
      "svix-signature": signature,
    },
  }
}

function store(): ProviderCallbackStore & {
  ingested: unknown[]
  reconciled: unknown[]
} {
  const ingested: unknown[] = []
  const reconciled: unknown[] = []
  return {
    ingested,
    reconciled,
    async ingest(event) {
      ingested.push(event)
      return { outcome: "UNMATCHED" }
    },
    async reconcile(input) {
      reconciled.push(input)
      return { examined: 0, applied: 0, stillUnmatched: 0 }
    },
  }
}

const on = {
  OT_T2_DELIVERY_CALLBACK_ENABLED: "true",
  OT_T2_RESEND_WEBHOOK_SECRET: SECRET,
}
const deps = (env: Record<string, string | undefined>, s = store()) => ({
  env,
  store: s,
  now: () => NOW,
})

describe("the endpoint fails closed without a secret, in every environment", () => {
  it.each(["production", "development", "test", undefined])(
    "refuses with NODE_ENV=%s",
    async (nodeEnv) => {
      const env = { ...on, NODE_ENV: nodeEnv, OT_T2_RESEND_WEBHOOK_SECRET: undefined }
      const s = store()
      await expect(
        ingestT2ResendCallback(signed(), deps(env, s)),
      ).resolves.toEqual({ ok: false, code: "SECRET_NOT_CONFIGURED" })
      expect(s.ingested).toEqual([])
    },
  )

  it.each(["", "   ", "short", "has space in it", "x".repeat(300)])(
    "treats a malformed secret %j as absent",
    async (secret) => {
      expect(getT2CallbackSecret({ OT_T2_RESEND_WEBHOOK_SECRET: secret })).toBeNull()
    },
  )

  it("accepts a well-formed secret", () => {
    expect(getT2CallbackSecret({ OT_T2_RESEND_WEBHOOK_SECRET: SECRET })).toBe(SECRET)
  })
})

describe("only a valid Svix signature is admitted", () => {
  it("admits a correctly signed envelope", async () => {
    const s = store()
    await expect(ingestT2ResendCallback(signed(), deps(on, s))).resolves.toEqual({
      ok: true,
      result: { outcome: "UNMATCHED" },
    })
    expect(s.ingested).toHaveLength(1)
  })

  it("refuses a signature made with a different secret", async () => {
    const s = store()
    const forged = signed({ secret: "whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" })
    await expect(ingestT2ResendCallback(forged, deps(on, s))).resolves.toEqual({
      ok: false,
      code: "INVALID_SIGNATURE",
    })
    expect(s.ingested).toEqual([])
  })

  it("refuses a body altered after signing", async () => {
    const envelope = signed()
    const tampered = {
      ...envelope,
      rawBody: envelope.rawBody.replace("email.delivered", "email.bounced"),
    }
    await expect(ingestT2ResendCallback(tampered, deps(on))).resolves.toEqual({
      ok: false,
      code: "INVALID_SIGNATURE",
    })
  })

  it("refuses an envelope id swapped after signing", async () => {
    const envelope = signed()
    const swapped = {
      ...envelope,
      headers: { ...envelope.headers, "svix-id": "msg_someone_elses_id" },
    }
    await expect(ingestT2ResendCallback(swapped, deps(on))).resolves.toEqual({
      ok: false,
      code: "INVALID_SIGNATURE",
    })
  })

  it.each(["svix-id", "svix-timestamp", "svix-signature"])(
    "refuses a missing %s",
    async (header) => {
      const envelope = signed()
      const headers = { ...envelope.headers, [header]: null }
      await expect(
        ingestT2ResendCallback({ ...envelope, headers }, deps(on)),
      ).resolves.toEqual({ ok: false, code: "INVALID_SIGNATURE" })
    },
  )

  it("has no raw-HMAC fallback: a resend-signature header alone is refused", async () => {
    const s = store()
    await expect(
      ingestT2ResendCallback(
        { rawBody: payload, headers: { "resend-signature": "deadbeef" } },
        deps(on, s),
      ),
    ).resolves.toEqual({ ok: false, code: "INVALID_SIGNATURE" })
    expect(s.ingested).toEqual([])
  })
})

describe("stale and future envelopes are refused independently of the library", () => {
  it("refuses a replay older than the tolerance", async () => {
    const old = new Date(NOW.getTime() - MAX_SIGNATURE_AGE_MS - 1000)
    await expect(
      ingestT2ResendCallback(signed({ at: old }), deps(on)),
    ).resolves.toEqual({ ok: false, code: "INVALID_SIGNATURE" })
  })

  it("refuses an envelope timestamped in the future", async () => {
    const ahead = new Date(NOW.getTime() + MAX_SIGNATURE_AGE_MS + 1000)
    await expect(
      ingestT2ResendCallback(signed({ at: ahead }), deps(on)),
    ).resolves.toEqual({ ok: false, code: "INVALID_SIGNATURE" })
  })

  it.each(["", "abc", "-1", "1.5", "99999999999999999999"])(
    "refuses a malformed timestamp %j",
    async (timestamp) => {
      const envelope = signed()
      await expect(
        ingestT2ResendCallback(
          { ...envelope, headers: { ...envelope.headers, "svix-timestamp": timestamp } },
          deps(on),
        ),
      ).resolves.toEqual({ ok: false, code: "INVALID_SIGNATURE" })
    },
  )
})

describe("nothing is admitted while the callback flag is not exactly true", () => {
  it.each([undefined, "", "false", "TRUE", "True", "1", "yes", "true "])(
    "flag %j admits nothing",
    async (flag) => {
      const s = store()
      await expect(
        ingestT2ResendCallback(signed(), deps({ ...on, OT_T2_DELIVERY_CALLBACK_ENABLED: flag }, s)),
      ).resolves.toEqual({ ok: false, code: "FLAG_DISABLED" })
      expect(s.ingested).toEqual([])
    },
  )
})

describe("the body is bounded and parsed only after the bytes are proven", () => {
  it("refuses an oversized body before verification", async () => {
    const huge = JSON.stringify({ type: "email.delivered", pad: "x".repeat(70_000) })
    const s = store()
    await expect(
      ingestT2ResendCallback(signed({ body: huge }), deps(on, s)),
    ).resolves.toEqual({ ok: false, code: "BODY_TOO_LARGE" })
    expect(s.ingested).toEqual([])
  })

  it("refuses a correctly signed body that is not JSON", async () => {
    const s = store()
    const outcome = await ingestT2ResendCallback(
      signed({ body: "not json at all" }),
      deps(on, s),
    )
    // Refused, and nothing was admitted. The exact code is deliberately not
    // pinned: the Svix verifier itself parses the payload, so it may refuse a
    // non-JSON body before this module's own parse ever runs. Both layers fail
    // closed, and which one gets there first is not a property worth freezing.
    expect(outcome.ok).toBe(false)
    expect(s.ingested).toEqual([])
  })

  it("refuses a correctly signed JSON body that is not an event object", async () => {
    const s = store()
    for (const body of ["[]", '"a string"', "42", "null"]) {
      await expect(
        ingestT2ResendCallback(signed({ body }), deps(on, s)),
      ).resolves.toEqual({ ok: false, code: "INVALID_JSON" })
    }
    expect(s.ingested).toEqual([])
  })

  it("verifies the exact bytes, so a re-serialized body would not pass", async () => {
    const envelope = signed()
    // Semantically identical JSON, different bytes.
    const reserialized = JSON.stringify(JSON.parse(envelope.rawBody), null, 2)
    expect(reserialized).not.toBe(envelope.rawBody)
    await expect(
      ingestT2ResendCallback({ ...envelope, headers: envelope.headers, rawBody: reserialized }, deps(on)),
    ).resolves.toEqual({ ok: false, code: "INVALID_SIGNATURE" })
  })
})

describe("the admitted event carries the signed envelope's identity", () => {
  it("uses the envelope id as the replay identity and keeps no recipient", async () => {
    const s = store()
    await ingestT2ResendCallback(signed({ id: "msg_envelope_identity" }), deps(on, s))
    expect(s.ingested[0]).toEqual({
      provider: "resend",
      providerEventId: "msg_envelope_identity",
      providerMessageId: MESSAGE_ID,
      eventType: "DELIVERED",
      reasonCode: null,
      occurredAt: OCCURRED_AT,
    })
    expect(JSON.stringify(s.ingested)).not.toContain("owner@example.com")
  })
})
