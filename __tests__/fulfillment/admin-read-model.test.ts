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

  it("valid DELIVERED + malformed BOUNCED(seq 0) with stored DELIVERED → fail closed, never DELIVERED", () => {
    // Controller-confirmed case: a malformed contradictory event must poison the whole
    // aggregate rather than being dropped so the surviving valid event shows success.
    const v = view({
      fulfillment: fulfillment({
        status: "DELIVERED",
        attemptCount: 1,
        attempts: [attempt(1)],
        artifacts: [artifact(1)],
        events: [event(2, "DELIVERED"), event(0, "BOUNCED", { providerEventId: "evt_bad" })],
      }),
    })
    expect(v.summary.displayState).not.toBe("DELIVERED")
    expect(v.summary.displayState).toBe("MANUAL_REVIEW")
    expect(v.summary.tone).not.toBe("success")
    expect(v.conflicted).toBe(true)
    expect(v.derivedDeliveryStatus).toBe("CONFLICT")
    const malformed = v.warnings.find((w) => w.code === "MALFORMED_EVENT")
    expect(malformed?.severity).toBe("danger")
    expect(v.warnings.map((w) => w.code)).toContain("EVIDENCE_CONFLICT")
  })

  it("syntactically valid event referencing a missing attempt → fail closed (orphaned pointer)", () => {
    const v = view({
      fulfillment: fulfillment({
        status: "DELIVERED",
        attemptCount: 1,
        attempts: [attempt(1)],
        artifacts: [artifact(1)],
        events: [event(2, "DELIVERED", { attemptNumber: 99 })],
      }),
    })
    expect(v.summary.displayState).not.toBe("DELIVERED")
    expect(v.summary.displayState).toBe("MANUAL_REVIEW")
    expect(v.conflicted).toBe(true)
    expect(v.derivedDeliveryStatus).toBe("CONFLICT")
    const orphan = v.warnings.find((w) => w.code === "EVENT_ATTEMPT_MISSING")
    expect(orphan?.severity).toBe("danger")
    expect(v.warnings.map((w) => w.code)).toContain("EVIDENCE_CONFLICT")
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

  it("suppresses a delivered attempt badge when any linked event is malformed", () => {
    const v = view({
      fulfillment: fulfillment({
        status: "DELIVERED",
        attemptCount: 1,
        artifacts: [artifact(1)],
        attempts: [attempt(1, { deliveredAt: "2026-08-03T00:00:02.000Z" })],
        events: [event(2, "DELIVERED"), event(0, "BOUNCED", { providerEventId: "evt_bad" })],
      }),
    })
    expect(v.summary.displayState).toBe("MANUAL_REVIEW")
    expect(v.summary.tone).not.toBe("success")
    expect(v.attempts[0]?.outcome).toBe("UNTRUSTED")
    expect(v.attempts[0]?.deliveredAt).toBeNull()
  })

  it("rejects attempt delivery timestamps that are not corroborated by a DELIVERED event", () => {
    const v = view({
      fulfillment: fulfillment({
        status: "PROVIDER_ACCEPTED",
        attemptCount: 1,
        artifacts: [artifact(1)],
        attempts: [attempt(1, { deliveredAt: "2026-08-03T00:00:02.000Z" })],
        events: [event(1, "ACCEPTED")],
      }),
    })
    expect(v.summary.displayState).toBe("MANUAL_REVIEW")
    expect(v.attempts[0]?.outcome).toBe("UNTRUSTED")
    expect(v.attempts[0]?.deliveredAt).toBeNull()
    expect(v.warnings.map((w) => w.code)).toContain("MALFORMED_ATTEMPT")
  })

  it("rejects provider events that predate their linked attempt and artifact", () => {
    const v = view({
      fulfillment: fulfillment({
        status: "DELIVERED",
        attemptCount: 1,
        artifacts: [artifact(1)],
        attempts: [attempt(1)],
        events: [event(1, "DELIVERED", { occurredAt: "2026-08-01T00:00:00.000Z", receivedAt: "2026-08-03T00:00:03.000Z" })],
      }),
    })
    expect(v.summary.displayState).toBe("MANUAL_REVIEW")
    expect(v.summary.tone).not.toBe("success")
    expect(v.conflicted).toBe(true)
    expect(v.warnings.map((w) => w.code)).toContain("MALFORMED_EVENT")
  })

  it("rejects future-dated attempts and provider events relative to injected now", () => {
    const future = "2027-01-01T00:00:00.000Z"
    const v = view({
      fulfillment: fulfillment({
        status: "DELIVERED",
        attemptCount: 1,
        artifacts: [artifact(1)],
        attempts: [attempt(1, { requestedAt: future, createdAt: future, deliveredAt: future })],
        events: [event(1, "DELIVERED", { occurredAt: future, receivedAt: future })],
      }),
    })
    expect(v.summary.displayState).toBe("MANUAL_REVIEW")
    expect(v.summary.tone).not.toBe("success")
    expect(v.attempts[0]?.outcome).toBe("UNTRUSTED")
    expect(v.conflicted).toBe(true)
  })

  it("fails closed and reports real rows when stored attemptCount is contradictory", () => {
    const v = view({
      fulfillment: fulfillment({
        status: "DELIVERED",
        attemptCount: -7,
        artifacts: [artifact(1)],
        attempts: [attempt(1)],
        events: [event(1, "DELIVERED")],
      }),
    })
    expect(v.summary.displayState).toBe("MANUAL_REVIEW")
    expect(v.summary.attemptCount).toBe(1)
    expect(v.summary.tone).not.toBe("success")
    expect(v.warnings.map((w) => w.code)).toContain("ATTEMPT_COUNT_MISMATCH")
  })

  it("rejects non-positive attempt numbers even when an event uses the same number", () => {
    const v = view({
      fulfillment: fulfillment({
        status: "DELIVERED",
        attemptCount: 1,
        artifacts: [artifact(1)],
        attempts: [attempt(-1, { deliveredAt: "2026-08-03T00:00:02.000Z" })],
        events: [event(2, "DELIVERED", { attemptNumber: -1 })],
      }),
    })
    expect(v.summary.displayState).toBe("MANUAL_REVIEW")
    expect(v.summary.tone).not.toBe("success")
    expect(v.attempts[0]?.outcome).toBe("UNTRUSTED")
    expect(v.warnings.map((w) => w.code)).toContain("MALFORMED_ATTEMPT")
  })

  it("suppresses malformed attempt provider metadata instead of leaking it", () => {
    const providerPii = "victim@example.com"
    const v = view({
      fulfillment: fulfillment({
        status: "ARTIFACT_READY",
        attemptCount: 1,
        artifacts: [artifact(1)],
        attempts: [attempt(1, { provider: providerPii })],
      }),
    })
    expect(v.summary.displayState).toBe("MANUAL_REVIEW")
    expect(JSON.stringify(v)).not.toContain(providerPii)
    expect(v.attempts[0]?.provider).toBe("invalid")
    expect(v.actions.filter((a) => a.action !== "INSPECT").every((a) => !a.wouldBeEligible)).toBe(true)
  })

  it("rejects provider events whose provider does not match the linked attempt", () => {
    const v = view({
      fulfillment: fulfillment({
        status: "DELIVERED",
        attemptCount: 1,
        artifacts: [artifact(1)],
        attempts: [attempt(1, { provider: "resend", deliveredAt: "2026-08-03T00:00:02.000Z" })],
        events: [event(2, "DELIVERED", { provider: "other" })],
      }),
    })
    expect(v.summary.displayState).toBe("MANUAL_REVIEW")
    expect(v.attempts[0]?.outcome).toBe("UNTRUSTED")
    expect(v.warnings.map((w) => w.code)).toContain("EVENT_PROVIDER_MISMATCH")
  })

  it("missing artifact lineage taints linked delivery evidence and prevents success", () => {
    const v = view({
      fulfillment: fulfillment({
        status: "DELIVERED",
        attemptCount: 1,
        artifacts: [],
        attempts: [attempt(1, { artifactVersion: 9, deliveredAt: "2026-08-03T00:00:02.000Z" })],
        events: [event(2, "DELIVERED")],
      }),
    })
    expect(v.summary.displayState).toBe("MANUAL_REVIEW")
    expect(v.artifact.present).toBe(false)
    expect(v.attempts[0]?.outcome).toBe("UNTRUSTED")
    expect(v.warnings.map((w) => w.code)).toContain("ATTEMPT_ARTIFACT_MISSING")
  })

  it("suppresses malformed artifact provenance instead of presenting it ready", () => {
    const v = view({
      fulfillment: fulfillment({
        status: "ARTIFACT_READY",
        artifacts: [artifact(-2, "bad", { byteSize: -1, generatorVersion: "", createdAt: "not-a-date" })],
      }),
    })
    expect(v.summary.displayState).toBe("MANUAL_REVIEW")
    expect(v.artifact.present).toBe(false)
    expect(v.warnings.map((w) => w.code)).toContain("MALFORMED_ARTIFACT")
    expect(v.actions.filter((a) => a.action !== "INSPECT").every((a) => !a.wouldBeEligible)).toBe(true)
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

  it("uses derived truth and the real attempt count for action eligibility", () => {
    const delivered = view({
      fulfillment: fulfillment({
        status: "DELAYED",
        attemptCount: 3,
        artifacts: [artifact(1)],
        attempts: [attempt(1), attempt(2), attempt(3)],
        events: [event(1, "ACCEPTED"), event(2, "DELIVERED")],
      }),
    })
    expect(delivered.summary.displayState).toBe("DELIVERED")
    expect(delivered.warnings.map((w) => w.code)).toContain("STATUS_DRIFT")
    expect(delivered.actions.find((a) => a.action === "RETRY_DELIVERY")?.wouldBeEligible).toBe(false)
  })

  it("marks every non-inspect action ineligible for an unsupported stored delivery state", () => {
    const unsupported = view({ fulfillment: fulfillment({ status: "DELAYED", artifacts: [artifact(1)] }) })
    expect(unsupported.summary.displayState).toBe("RECONCILIATION_NEEDED")
    expect(unsupported.derivedDeliveryStatus).toBe("UNSUPPORTED")
    expect(unsupported.actions.filter((a) => a.action !== "INSPECT").every((a) => !a.wouldBeEligible)).toBe(true)
  })
})

describe("Slice 2 — artifact provenance is read-only, bounded, and fingerprint-free", () => {
  const PROVENANCE = {
    generatedAt: "2026-08-01T23:00:00.000Z",
    sourceOrderId: "ord_1",
    propertyBinding: "MATCHES" as const,
  }
  const bound = (overrides = {}) =>
    fulfillment({
      status: "ARTIFACT_READY",
      artifacts: [artifact(1, "c".repeat(64), { ...PROVENANCE, ...overrides })],
    })

  /**
   * The whole point of tainting: untrustworthy provenance must not merely raise a
   * warning next to an otherwise-healthy view. It must reach the SAME fail-closed
   * state as malformed evidence — manual review, conflicted, and no eligible
   * action beyond read-only inspection.
   */
  const expectFailedClosed = (v: ReturnType<typeof view>) => {
    expect(v.summary.displayState).toBe("MANUAL_REVIEW")
    expect(v.conflicted).toBe(true)
    expect(v.derivedDeliveryStatus).toBe("CONFLICT")
    expect(v.warnings.map((w) => w.code)).toContain("EVIDENCE_CONFLICT")
    const byAction = Object.fromEntries(v.actions.map((a) => [a.action, a]))
    expect(byAction.REGENERATE_ARTIFACT!.wouldBeEligible).toBe(false)
    expect(byAction.RETRY_DELIVERY!.wouldBeEligible).toBe(false)
    // Read-only inspection is the one thing that stays available.
    expect(byAction.INSPECT!.wouldBeEligible).toBe(true)
    expect(v.actions.every((a) => a.enabled === false)).toBe(true)
  }

  it("reports RECORDED and surfaces the generation time when provenance is complete", () => {
    const v = view({ fulfillment: bound() })
    expect(v.artifact.provenance).toBe("RECORDED")
    expect(v.artifact.generatedAt).toBe("2026-08-01T23:00:00.000Z")
    expect(v.artifact.propertyBinding).toBe("MATCHES")
    expect(v.warnings.map((w) => w.code)).not.toContain("ARTIFACT_PROVENANCE_MISMATCH")
    // Coherent provenance must NOT taint: this is the control case.
    expect(v.conflicted).toBe(false)
    expect(v.summary.displayState).not.toBe("MANUAL_REVIEW")
  })

  it("reports ABSENT without warning for artifacts bound before Slice 2", () => {
    // Every deployed Phase 1 row is in this shape. Warning on them would make the
    // console unreadable and would wrongly imply a defect.
    const v = view({ fulfillment: fulfillment({ status: "ARTIFACT_READY", artifacts: [artifact(1)] }) })
    expect(v.artifact.provenance).toBe("ABSENT")
    expect(v.artifact.generatedAt).toBeNull()
    expect(v.artifact.propertyBinding).toBe("ABSENT")
    const codes = v.warnings.map((w) => w.code)
    expect(codes).not.toContain("ARTIFACT_PROVENANCE_MISMATCH")
    expect(codes).not.toContain("ARTIFACT_PROVENANCE_PARTIAL")
    expect(codes).not.toContain("ARTIFACT_PROPERTY_BINDING_UNTRUSTED")
    // Legacy absence is silent AND non-tainting.
    expect(v.conflicted).toBe(false)
    expect(v.actions.find((a) => a.action === "RETRY_DELIVERY")!.wouldBeEligible).toBe(true)
  })

  it("fails closed to MISMATCHED when the artifact names a different source order", () => {
    const v = view({ fulfillment: bound({ sourceOrderId: "ord_SOMEONE_ELSE" }) })
    expect(v.artifact.provenance).toBe("MISMATCHED")
    // A timestamp must not be displayed alongside provenance we do not trust.
    expect(v.artifact.generatedAt).toBeNull()
    expect(v.warnings.map((w) => w.code)).toContain("ARTIFACT_PROVENANCE_MISMATCH")
    // These bytes may describe someone else's property: not a display nit.
    expectFailedClosed(v)
  })

  it("fails closed to MISMATCHED when bytes claim to predate nothing / postdate their row", () => {
    const v = view({ fulfillment: bound({ generatedAt: "2026-08-09T00:00:00.000Z" }) })
    expect(v.artifact.provenance).toBe("MISMATCHED")
    expectFailedClosed(v)
  })

  it("reports PARTIAL and taints when only part of the provenance triple is recorded", () => {
    const v = view({ fulfillment: bound({ propertyBinding: "ABSENT" }) })
    expect(v.artifact.provenance).toBe("PARTIAL")
    expect(v.artifact.generatedAt).toBeNull()
    expect(v.warnings.map((w) => w.code)).toContain("ARTIFACT_PROVENANCE_PARTIAL")
    // Half-written provenance cannot be authenticated either way.
    expectFailedClosed(v)
  })

  it.each([["generatedAt"], ["sourceOrderId"]])(
    "taints a provenance triple missing %s",
    (field) => {
      const v = view({ fulfillment: bound({ [field]: null }) })
      expect(v.artifact.provenance).toBe("PARTIAL")
      expectFailedClosed(v)
    },
  )

  it("classifies a locator without ever echoing it, and fails closed on a public bearer URL", () => {
    const v = view({
      fulfillment: bound({ storageLocator: "https://public.example.com/packets/leak.pdf?token=abc" }),
    })
    expect(v.artifact.locatorClass).toBe("UNSAFE_PUBLIC")
    expect(v.warnings.map((w) => w.code)).toContain("ARTIFACT_LOCATOR_UNSAFE")
    const json = JSON.stringify(v)
    expect(json).not.toContain("public.example.com")
    expect(json).not.toContain("token=abc")
    expectFailedClosed(v)
  })

  it("reports NOT_LOADED when the loader withholds the locator, as it does in production", () => {
    const v = view({
      fulfillment: fulfillment({
        status: "ARTIFACT_READY",
        artifacts: [{ version: 1, artifactSha256: "c".repeat(64), byteSize: 12345, generatorVersion: "gen_v1", templateVersion: "tpl_v1", createdAt: "2026-08-02T00:00:00.000Z", ...PROVENANCE }],
      }),
    })
    expect(v.artifact.locatorClass).toBe("NOT_LOADED")
    // Not fetching the locator is the production posture and is not a defect.
    expect(v.conflicted).toBe(false)
  })

  // --- Property binding: presence is not agreement -------------------------
  it.each([["DRIFTED"], ["MALFORMED"], ["UNVERIFIABLE"]])(
    "fails closed when the property binding is %s",
    (state) => {
      const v = view({ fulfillment: bound({ propertyBinding: state }) })
      expect(v.artifact.propertyBinding).toBe(state)
      expect(v.warnings.map((w) => w.code)).toContain("ARTIFACT_PROPERTY_BINDING_UNTRUSTED")
      // An untrusted binding must also suppress the generation time, which
      // would otherwise read as an authoritative fact about these bytes.
      expect(v.artifact.generatedAt).toBeNull()
      expectFailedClosed(v)
    },
  )

  it("never surfaces the property-binding fingerprint, only the bounded match state", () => {
    // The input type carries an enum, not the digest, so the view is
    // structurally incapable of leaking the PIN/address derivative.
    const v = view({ fulfillment: bound() })
    const json = JSON.stringify(v)
    expect(json).not.toContain("propertyBindingFingerprint")
    expect(json).not.toContain("fingerprint")
    expect(v.artifact.propertyBinding).toBe("MATCHES")
    expect(["ABSENT", "MATCHES", "DRIFTED", "MALFORMED", "UNVERIFIABLE"]).toContain(
      v.artifact.propertyBinding,
    )
  })

  it("exposes no mutation affordance alongside provenance", () => {
    const v = view({ fulfillment: bound() })
    expect(v.actions.every((a) => a.enabled === false)).toBe(true)
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
