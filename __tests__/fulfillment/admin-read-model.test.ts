/**
 * @jest-environment node
 *
 * Phase 2 admin evidence read model — pure, deterministic projection of Phase 1
 * records into an admin-facing, redacted view. No DB, no side effects. Fails
 * closed on unknown/contradictory state; never infers delivery from provider
 * acceptance or stored status; never leaks PII / private locators / raw payloads.
 */
import {
  deriveAdminEvidenceView,
  type AdminEvidenceInput,
  type EvidenceFulfillmentInput,
} from "@/lib/fulfillment/admin-read-model"

const NOW = "2026-08-08T12:00:00.000Z"

function order(overrides: Partial<AdminEvidenceInput["order"]> = {}): AdminEvidenceInput["order"] {
  return {
    id: "ord_1",
    tier: "T2",
    status: "PAID",
    amountPaid: 149,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  }
}

function fulfillment(overrides: Partial<EvidenceFulfillmentInput> = {}): EvidenceFulfillmentInput {
  return {
    id: "ful_1",
    kind: "T2_APPEAL_EVIDENCE",
    status: "NOT_STARTED",
    statusRevision: 0,
    attemptCount: 0,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    lastReasonCode: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    artifacts: [],
    attempts: [],
    events: [],
    ...overrides,
  }
}

function artifact(version: number, sha = "a".repeat(64), overrides = {}) {
  return {
    version,
    artifactSha256: sha,
    byteSize: 12345,
    storageLocator: `artifacts/ful_1/v${version}.pdf`,
    generatorVersion: "gen_v1",
    templateVersion: "tpl_v1",
    createdAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  }
}

function attempt(n: number, overrides = {}) {
  return {
    attemptNumber: n,
    artifactVersion: 1,
    provider: "resend",
    providerMessageId: "re_8Qk1xZ4mVn7Pb2Ld",
    idempotencyKey: "otf:v1:DELIVERY:ord_1:1:sha:gen",
    requestedAt: "2026-08-03T00:00:00.000Z",
    providerAcceptedAt: null,
    deliveredAt: null,
    delayedAt: null,
    failedAt: null,
    reasonCode: null,
    createdAt: "2026-08-03T00:00:00.000Z",
    ...overrides,
  }
}

function event(seq: number, eventType: string, overrides = {}) {
  return {
    provider: "resend",
    providerEventId: `evt_${seq}`,
    eventType,
    sequence: seq,
    occurredAt: new Date(Date.parse("2026-08-03T00:00:00.000Z") + seq * 1000).toISOString(),
    reasonCode: null,
    attemptNumber: 1,
    receivedAt: "2026-08-03T00:00:10.000Z",
    ...overrides,
  }
}

function view(input: Partial<AdminEvidenceInput> = {}) {
  return deriveAdminEvidenceView({ order: order(), fulfillment: null, now: NOW, ...input })
}

describe("no fulfillment record", () => {
  it("unpaid order → NOT_STARTED", () => {
    const v = view({ order: order({ status: "PENDING", amountPaid: 0 }), fulfillment: null })
    expect(v.hasFulfillment).toBe(false)
    expect(v.summary.displayState).toBe("NOT_STARTED")
    expect(v.warnings.map((w) => w.code)).not.toContain("RECONCILIATION_NEEDED")
  })

  it("paid order with no fulfillment → RECONCILIATION_NEEDED (never delivered)", () => {
    const v = view({ order: order({ status: "PAID", amountPaid: 149 }), fulfillment: null })
    expect(v.summary.displayState).toBe("RECONCILIATION_NEEDED")
    expect(v.summary.displayState).not.toBe("DELIVERED")
    expect(v.warnings.map((w) => w.code)).toContain("RECONCILIATION_NEEDED")
  })
})

describe("pre-delivery state projections", () => {
  it.each([
    ["NOT_STARTED", "NOT_STARTED"],
    ["NEEDS_RECONCILIATION", "RECONCILIATION_NEEDED"],
    ["INELIGIBLE", "INELIGIBLE"],
    ["INCOMPLETE_INPUT", "INCOMPLETE_INPUT"],
    ["MANUAL_REVIEW", "MANUAL_REVIEW"],
    ["CANCELLED", "CANCELLED"],
  ])("status %s → display %s", (status, display) => {
    expect(view({ fulfillment: fulfillment({ status }) }).summary.displayState).toBe(display)
  })

  it("ARTIFACT_PENDING with no lease → QUEUED", () => {
    expect(view({ fulfillment: fulfillment({ status: "ARTIFACT_PENDING" }) }).summary.displayState).toBe("QUEUED")
  })

  it("ARTIFACT_PENDING with an active lease → LEASED", () => {
    const v = view({
      fulfillment: fulfillment({
        status: "ARTIFACT_PENDING",
        leaseOwner: "worker-7",
        leaseToken: "tok_secret",
        leaseExpiresAt: "2026-08-08T12:05:00.000Z",
      }),
    })
    expect(v.summary.displayState).toBe("LEASED")
    expect(v.lease.state).toBe("ACTIVE")
  })

  it("ARTIFACT_PENDING with an expired lease → STALE_LEASE (warning)", () => {
    const v = view({
      fulfillment: fulfillment({
        status: "ARTIFACT_PENDING",
        leaseOwner: "worker-7",
        leaseToken: "tok_secret",
        leaseExpiresAt: "2026-08-08T11:59:59.000Z",
      }),
    })
    expect(v.summary.displayState).toBe("STALE_LEASE")
    expect(v.lease.state).toBe("STALE")
    expect(v.warnings.map((w) => w.code)).toContain("STALE_LEASE")
  })

  it("ARTIFACT_READY with an artifact → ARTIFACT_READY", () => {
    const v = view({ fulfillment: fulfillment({ status: "ARTIFACT_READY", artifacts: [artifact(1)] }) })
    expect(v.summary.displayState).toBe("ARTIFACT_READY")
    expect(v.artifact.present).toBe(true)
    expect(v.artifact.version).toBe(1)
  })

  it("ARTIFACT_READY with NO artifact → ARTIFACT_FAILED (fail closed) + warning", () => {
    const v = view({ fulfillment: fulfillment({ status: "ARTIFACT_READY", artifacts: [] }) })
    expect(v.summary.displayState).toBe("ARTIFACT_FAILED")
    expect(v.warnings.map((w) => w.code)).toContain("ARTIFACT_MISSING")
  })

  it("FAILED with artifacts but no attempts → ARTIFACT_FAILED", () => {
    expect(view({ fulfillment: fulfillment({ status: "FAILED", artifacts: [artifact(1)] }) }).summary.displayState).toBe(
      "ARTIFACT_FAILED",
    )
  })
})

describe("delivery outcomes are derived from the event ledger, not the stored status", () => {
  const ready = { status: "DELIVERY_PENDING", attemptCount: 1, artifacts: [artifact(1)], attempts: [attempt(1)] }

  it("provider accepted event → PROVIDER_ACCEPTED + accepted-not-delivered warning", () => {
    const v = view({
      fulfillment: fulfillment({ ...ready, status: "PROVIDER_ACCEPTED", events: [event(1, "ACCEPTED")] }),
    })
    expect(v.summary.displayState).toBe("PROVIDER_ACCEPTED")
    expect(v.summary.displayState).not.toBe("DELIVERED")
    expect(v.warnings.map((w) => w.code)).toContain("ACCEPTED_NOT_DELIVERED")
  })

  it("accepted then delivered → DELIVERED", () => {
    const v = view({
      fulfillment: fulfillment({ ...ready, status: "DELIVERED", events: [event(1, "ACCEPTED"), event(2, "DELIVERED")] }),
    })
    expect(v.summary.displayState).toBe("DELIVERED")
  })

  it("delivered then complained → COMPLAINED (later terminal supersedes; history preserved)", () => {
    const v = view({
      fulfillment: fulfillment({
        ...ready,
        status: "DELIVERED",
        events: [event(1, "ACCEPTED"), event(2, "DELIVERED"), event(3, "COMPLAINED")],
      }),
    })
    expect(v.summary.displayState).toBe("COMPLAINED")
    expect(v.timeline).toHaveLength(3) // delivered event still present
  })

  it("delayed → DELIVERY_DELAYED", () => {
    const v = view({ fulfillment: fulfillment({ ...ready, status: "DELAYED", events: [event(1, "ACCEPTED"), event(2, "DELAYED")] }) })
    expect(v.summary.displayState).toBe("DELIVERY_DELAYED")
  })

  it("bounced → BOUNCED (terminal warning)", () => {
    const v = view({ fulfillment: fulfillment({ ...ready, status: "BOUNCED", events: [event(1, "BOUNCED", { reasonCode: "HARD_BOUNCE" })] }) })
    expect(v.summary.displayState).toBe("BOUNCED")
    expect(v.warnings.map((w) => w.code)).toContain("HARD_BOUNCE")
  })

  it("stored DELIVERED but NO events → fail closed to RECONCILIATION_NEEDED + STATUS_DRIFT (never shows DELIVERED)", () => {
    const v = view({ fulfillment: fulfillment({ ...ready, status: "DELIVERED", events: [] }) })
    expect(v.summary.displayState).not.toBe("DELIVERED")
    expect(v.summary.displayState).toBe("RECONCILIATION_NEEDED")
    expect(v.warnings.map((w) => w.code)).toContain("STATUS_DRIFT")
  })

  it("stored ARTIFACT_READY but events show BOUNCED → derived BOUNCED wins + drift warning", () => {
    const v = view({ fulfillment: fulfillment({ ...ready, status: "ARTIFACT_READY", events: [event(1, "BOUNCED")] }) })
    expect(v.summary.displayState).toBe("BOUNCED")
    expect(v.warnings.map((w) => w.code)).toContain("STATUS_DRIFT")
  })
})

describe("deterministic ordering", () => {
  it("timeline is ordered by sequence regardless of input order", () => {
    const evs = [event(3, "DELIVERED"), event(1, "REQUESTED"), event(2, "ACCEPTED")]
    const v = view({ fulfillment: fulfillment({ status: "DELIVERED", attemptCount: 1, attempts: [attempt(1)], artifacts: [artifact(1)], events: evs }) })
    expect(v.timeline.map((t) => t.sequence)).toEqual([1, 2, 3])
  })

  it("attempts are ordered by attemptNumber", () => {
    const v = view({
      fulfillment: fulfillment({
        status: "DELIVERY_PENDING",
        attemptCount: 2,
        artifacts: [artifact(1)],
        attempts: [attempt(2), attempt(1)],
      }),
    })
    expect(v.attempts.map((a) => a.attemptNumber)).toEqual([1, 2])
  })

  it("is deterministic (same input → deep-equal output)", () => {
    const f = fulfillment({ status: "DELIVERED", attemptCount: 1, attempts: [attempt(1)], artifacts: [artifact(1)], events: [event(1, "ACCEPTED"), event(2, "DELIVERED")] })
    expect(deriveAdminEvidenceView({ order: order(), fulfillment: f, now: NOW })).toEqual(
      deriveAdminEvidenceView({ order: order(), fulfillment: f, now: NOW }),
    )
  })
})

describe("malformed / hostile records fail closed", () => {
  it("unknown stored status → UNKNOWN display + warning, never DELIVERED", () => {
    const v = view({ fulfillment: fulfillment({ status: "TOTALLY_BOGUS" }) })
    expect(v.summary.displayState).toBe("UNKNOWN")
    expect(v.summary.tone).toBe("danger")
    expect(v.warnings.map((w) => w.code)).toContain("UNKNOWN_STATUS")
  })

  it("malformed event (bad type / non-instant) is flagged and excluded from the fold", () => {
    const v = view({
      fulfillment: fulfillment({
        status: "DELIVERY_PENDING",
        attemptCount: 1,
        attempts: [attempt(1)],
        artifacts: [artifact(1)],
        events: [event(1, "FORGED_TYPE"), event(2, "DELIVERED", { occurredAt: "not-a-date" })],
      }),
    })
    expect(v.warnings.map((w) => w.code)).toContain("MALFORMED_EVENT")
    expect(v.summary.displayState).not.toBe("DELIVERED")
  })

  it("conflicting duplicate sequences → fail closed to MANUAL_REVIEW + conflict warning", () => {
    const v = view({
      fulfillment: fulfillment({
        status: "DELIVERY_PENDING",
        attemptCount: 1,
        attempts: [attempt(1)],
        artifacts: [artifact(1)],
        events: [event(1, "DELIVERED"), event(1, "BOUNCED", { providerEventId: "evt_x" })],
      }),
    })
    expect(v.conflicted).toBe(true)
    expect(v.summary.displayState).toBe("MANUAL_REVIEW")
    expect(v.warnings.map((w) => w.code)).toContain("EVIDENCE_CONFLICT")
  })

  it("an attempt referencing a missing artifact version is flagged", () => {
    const v = view({
      fulfillment: fulfillment({
        status: "DELIVERY_PENDING",
        attemptCount: 1,
        artifacts: [],
        attempts: [attempt(1, { artifactVersion: 9 })],
      }),
    })
    expect(v.warnings.map((w) => w.code)).toContain("ATTEMPT_ARTIFACT_MISSING")
  })

  it("an invalid (unknown) reason code is flagged, not echoed as authoritative", () => {
    const v = view({ fulfillment: fulfillment({ status: "BOUNCED", attemptCount: 1, attempts: [attempt(1)], artifacts: [artifact(1)], events: [event(1, "BOUNCED", { reasonCode: "leaked secret text" })] }) })
    expect(v.warnings.map((w) => w.code)).toContain("INVALID_REASON_CODE")
  })
})

describe("display-only action eligibility", () => {
  it("always exposes INSPECT and renders every action inert (never interactive)", () => {
    const v = view({ fulfillment: fulfillment({ status: "ARTIFACT_READY", artifacts: [artifact(1)] }) })
    const keys = v.actions.map((a) => a.action)
    expect(keys).toContain("INSPECT")
    expect(keys).toContain("REGENERATE_ARTIFACT")
    expect(keys).toContain("RETRY_DELIVERY")
    for (const a of v.actions) {
      expect(a.enabled).toBe(false)
      expect(a.interactive).toBe(false)
    }
  })

  it("retry would be eligible from DELAYED and ineligible from a terminal bounce", () => {
    const delayed = view({ fulfillment: fulfillment({ status: "DELAYED", attemptCount: 1, attempts: [attempt(1)], artifacts: [artifact(1)], events: [event(1, "ACCEPTED"), event(2, "DELAYED")] }) })
    const retryDelayed = delayed.actions.find((a) => a.action === "RETRY_DELIVERY")!
    expect(retryDelayed.wouldBeEligible).toBe(true)

    const bounced = view({ fulfillment: fulfillment({ status: "BOUNCED", attemptCount: 1, attempts: [attempt(1)], artifacts: [artifact(1)], events: [event(1, "BOUNCED")] }) })
    const retryBounced = bounced.actions.find((a) => a.action === "RETRY_DELIVERY")!
    expect(retryBounced.wouldBeEligible).toBe(false)
  })
})

describe("privacy / redaction — never leak PII, locators, tokens, or raw payloads", () => {
  const hostile = fulfillment({
    status: "DELIVERED",
    attemptCount: 1,
    leaseOwner: "worker-secret-1",
    leaseToken: "tok_SUPER_SECRET",
    leaseExpiresAt: "2026-08-08T13:00:00.000Z",
    artifacts: [artifact(1, "b".repeat(64), { storageLocator: "s3://private-bucket/secret/path/v1.pdf" })],
    attempts: [
      attempt(1, {
        providerMessageId: "re_RAWMESSAGEID_98765",
        idempotencyKey: "otf:v1:DELIVERY:SECRET_ORDER:1:sha:gen",
      }),
    ],
    events: [event(1, "ACCEPTED"), event(2, "DELIVERED")],
  })

  const forbidden = [
    "s3://private-bucket/secret/path/v1.pdf", // storage locator
    "tok_SUPER_SECRET", // lease token
    "otf:v1:DELIVERY:SECRET_ORDER:1:sha:gen", // idempotency key
    "re_RAWMESSAGEID_98765", // raw provider message id
    "victim@example.com", // email (never in input to output)
    "PIN12345", // pin
  ]

  it("the derived view JSON contains no forbidden secret substring", () => {
    const v = deriveAdminEvidenceView({
      // Simulate an upstream row that also carries PII fields; the read model must
      // never copy them into the view (they are not part of EvidenceOrderInput).
      order: { ...order(), email: "victim@example.com", propertyPin: "PIN12345" } as unknown as AdminEvidenceInput["order"],
      fulfillment: hostile,
      now: NOW,
    })
    const json = JSON.stringify(v)
    for (const secret of forbidden) expect(json).not.toContain(secret)
  })

  it("never exposes a storageLocator field on the artifact view", () => {
    const v = deriveAdminEvidenceView({ order: order(), fulfillment: hostile, now: NOW })
    expect(JSON.stringify(v.artifact)).not.toContain("storageLocator")
    expect(JSON.stringify(v)).not.toContain("storagelocator".replace("l", "l")) // literal key absent
    // content-address facts (sha256, byteSize) ARE allowed
    expect(v.artifact.sha256).toBe("b".repeat(64))
    expect(v.artifact.byteSize).toBe(12345)
  })

  it("a present provider message id is shown only masked", () => {
    const v = deriveAdminEvidenceView({ order: order(), fulfillment: hostile, now: NOW })
    const a = v.attempts[0]!
    expect(a.providerMessageIdMasked).not.toBeNull()
    expect(a.providerMessageIdMasked).not.toContain("RAWMESSAGEID")
  })
})
