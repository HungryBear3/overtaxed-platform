/**
 * OT T2 delivery-evidence — Phase 2 admin evidence read model (PURE).
 *
 * Deterministically derives an admin-facing, fully-redacted evidence view from the
 * append-only Phase 1 records (fulfillment summary + artifacts + attempts + provider
 * events). This module is framework-free and database-free: it takes plain record
 * shapes as input and returns a plain view. It performs NO writes, NO IO, and reads
 * no clock (the caller injects `now`), so it preserves the Phase 1 import-purity
 * guarantee and is exhaustively unit-testable.
 *
 * Safety contract:
 *   - Fail closed on unknown or contradictory state; never surface DELIVERED unless
 *     a provider DELIVERED event is present and not superseded.
 *   - Never infer delivery from provider acceptance or from the stored order status.
 *   - Never leak email, PIN, order token, private storage locator, lease token,
 *     idempotency key, raw provider payload, raw exception, or artifact bytes. A
 *     present provider message id / event id / lease owner is shown only masked.
 *   - Action eligibility is display-only; nothing here mutates or authorizes a send.
 */
import type { OTDeliveryEventType, OTFulfillmentStatus } from "@/lib/fulfillment/types"
import { FULFILLMENT_STATUSES, REASON_CODES } from "@/lib/fulfillment/types"
import type { DeliveryEvent } from "@/lib/fulfillment/state"
import { foldDeliveryEvents, initialFoldState, validateDeliveryEvent } from "@/lib/fulfillment/state"
import { isPgIntInRange, isValidArtifactSha256, isValidByteSize, isValidProviderName, parseStrictInstant, PG_INT_MAX } from "@/lib/fulfillment/validation"
import { decideDeliverySend, decideRegeneration } from "@/lib/fulfillment/retry"

// ---------- Input shapes (mirror the Phase 1 rows the loader passes) ----------

export type EvidenceOrderInput = {
  id: string
  tier: string
  status: string
  amountPaid: number
  createdAt: string
}

export type EvidenceArtifactInput = {
  version: number
  artifactSha256: string
  byteSize: number
  // PRIVATE and OPTIONAL: the derivation never reads it, so the loader need not even
  // fetch it from the database. Accepted here only so hostile fixtures can prove it
  // is dropped.
  storageLocator?: string
  generatorVersion: string
  templateVersion: string | null
  createdAt: string
}

export type EvidenceAttemptInput = {
  attemptNumber: number
  artifactVersion: number
  provider: string
  providerMessageId: string | null
  // Internal and OPTIONAL: never read by the derivation nor fetched by the loader.
  idempotencyKey?: string
  requestedAt: string
  providerAcceptedAt: string | null
  deliveredAt: string | null
  delayedAt: string | null
  failedAt: string | null
  reasonCode: string | null
  createdAt: string
}

export type EvidenceEventInput = {
  provider: string
  providerEventId: string
  eventType: string
  sequence: number
  occurredAt: string
  reasonCode: string | null
  attemptNumber: number
  receivedAt: string
}

export type EvidenceFulfillmentInput = {
  id: string
  kind: string
  status: string
  statusRevision: number
  attemptCount: number
  leaseOwner: string | null
  // Internal and OPTIONAL: never read by the derivation nor fetched by the loader.
  leaseToken?: string | null
  leaseExpiresAt: string | null
  lastReasonCode: string | null
  createdAt: string
  updatedAt: string
  artifacts: readonly EvidenceArtifactInput[]
  attempts: readonly EvidenceAttemptInput[]
  events: readonly EvidenceEventInput[]
}

export type AdminEvidenceInput = {
  order: EvidenceOrderInput
  fulfillment: EvidenceFulfillmentInput | null
  now: string
}

// ---------- Output shapes (derived + redacted) ----------

export type DisplayState =
  | "NOT_STARTED"
  | "RECONCILIATION_NEEDED"
  | "INELIGIBLE"
  | "INCOMPLETE_INPUT"
  | "MANUAL_REVIEW"
  | "QUEUED"
  | "LEASED"
  | "STALE_LEASE"
  | "ARTIFACT_READY"
  | "ARTIFACT_FAILED"
  | "DELIVERY_PENDING"
  | "PROVIDER_ACCEPTED"
  | "DELIVERED"
  | "DELIVERY_DELAYED"
  | "BOUNCED"
  | "COMPLAINED"
  | "DELIVERY_FAILED"
  | "CANCELLED"
  | "UNKNOWN"

export type Tone = "neutral" | "info" | "progress" | "success" | "warn" | "danger"

export type EvidenceSummary = {
  displayState: DisplayState
  label: string
  tone: Tone
  recordedStatus: string
  statusRevision: number
  kind: string
  attemptCount: number
  createdAt: string | null
  updatedAt: string | null
}

export type LeaseState = "NONE" | "ACTIVE" | "STALE" | "INVALID"
export type LeaseView = { state: LeaseState; ownerMasked: string | null; expiresAt: string | null }

export type ArtifactView = {
  present: boolean
  version: number | null
  sha256: string | null
  byteSize: number | null
  generatorVersion: string | null
  templateVersion: string | null
  createdAt: string | null
}

export type AttemptOutcome = "CREATED" | "ACCEPTED" | "DELIVERED" | "DELAYED" | "FAILED" | "UNTRUSTED"
export type AttemptView = {
  attemptNumber: number
  artifactVersion: number
  provider: string
  providerMessageIdMasked: string | null
  outcome: AttemptOutcome
  requestedAt: string | null
  acceptedAt: string | null
  deliveredAt: string | null
  reasonCode: string | null
}

export type TimelineEntry = {
  sequence: number
  eventType: OTDeliveryEventType | "UNKNOWN"
  occurredAt: string | null
  attemptNumber: number
  reasonCode: string | null
  eventRefMasked: string
}

export type WarningCode =
  | "RECONCILIATION_NEEDED"
  | "STALE_LEASE"
  | "INVALID_LEASE"
  | "ACCEPTED_NOT_DELIVERED"
  | "HARD_BOUNCE"
  | "SPAM_COMPLAINT"
  | "DELIVERY_FAILED"
  | "ARTIFACT_MISSING"
  | "ATTEMPT_ARTIFACT_MISSING"
  | "EVENT_ATTEMPT_MISSING"
  | "EVENT_PROVIDER_MISMATCH"
  | "MALFORMED_ATTEMPT"
  | "ATTEMPT_COUNT_MISMATCH"
  | "MALFORMED_ARTIFACT"
  | "MALFORMED_EVENT"
  | "EVIDENCE_CONFLICT"
  | "STATUS_DRIFT"
  | "INVALID_REASON_CODE"
  | "UNKNOWN_STATUS"

export type WarningSeverity = "info" | "warn" | "danger"
export type Warning = { code: WarningCode; message: string; severity: WarningSeverity }

export type ActionKey = "INSPECT" | "REGENERATE_ARTIFACT" | "RETRY_DELIVERY"
export type ActionView = {
  action: ActionKey
  label: string
  enabled: false
  interactive: false
  wouldBeEligible: boolean
  reason: string
}

export type AdminEvidenceView = {
  orderId: string
  hasFulfillment: boolean
  summary: EvidenceSummary
  lease: LeaseView
  artifact: ArtifactView
  attempts: readonly AttemptView[]
  timeline: readonly TimelineEntry[]
  warnings: readonly Warning[]
  actions: readonly ActionView[]
  derivedDeliveryStatus: string
  conflicted: boolean
}

// ---------- Redaction helpers ----------

/** Mask an opaque id so its presence is provable without leaking the raw value. */
function maskOpaque(value: string | null): string | null {
  if (typeof value !== "string" || value.length === 0) return null
  if (value.length <= 6) return "•••"
  return `${value.slice(0, 3)}•••${value.slice(-2)}`
}

const DELIVERY_OUTCOME_STATUSES: ReadonlySet<string> = new Set([
  "PROVIDER_ACCEPTED",
  "DELIVERED",
  "DELAYED",
  "BOUNCED",
  "COMPLAINED",
])

const LABELS: Record<DisplayState, string> = {
  NOT_STARTED: "Not started",
  RECONCILIATION_NEEDED: "Reconciliation needed",
  INELIGIBLE: "Ineligible",
  INCOMPLETE_INPUT: "Incomplete input",
  MANUAL_REVIEW: "Manual review",
  QUEUED: "Queued",
  LEASED: "Leased",
  STALE_LEASE: "Stale lease",
  ARTIFACT_READY: "Artifact ready",
  ARTIFACT_FAILED: "Artifact failed",
  DELIVERY_PENDING: "Delivery pending",
  PROVIDER_ACCEPTED: "Provider accepted",
  DELIVERED: "Delivered",
  DELIVERY_DELAYED: "Delivery delayed",
  BOUNCED: "Bounced",
  COMPLAINED: "Complained",
  DELIVERY_FAILED: "Delivery failed",
  CANCELLED: "Cancelled",
  UNKNOWN: "Unknown",
}

const TONES: Record<DisplayState, Tone> = {
  NOT_STARTED: "neutral",
  RECONCILIATION_NEEDED: "danger",
  INELIGIBLE: "neutral",
  INCOMPLETE_INPUT: "warn",
  MANUAL_REVIEW: "warn",
  QUEUED: "info",
  LEASED: "progress",
  STALE_LEASE: "warn",
  ARTIFACT_READY: "info",
  ARTIFACT_FAILED: "danger",
  DELIVERY_PENDING: "progress",
  PROVIDER_ACCEPTED: "progress",
  DELIVERED: "success",
  DELIVERY_DELAYED: "warn",
  BOUNCED: "danger",
  COMPLAINED: "danger",
  DELIVERY_FAILED: "danger",
  CANCELLED: "neutral",
  UNKNOWN: "danger",
}

// ---------- Derivation ----------

function isPaid(order: EvidenceOrderInput): boolean {
  const s = String(order.status ?? "")
  return s === "PAID" || s === "PAID_RECOVERY_REQUIRED" || Number(order.amountPaid) > 0
}

function deriveLease(f: EvidenceFulfillmentInput, now: string): LeaseView {
  const hasAny = Boolean(f.leaseOwner) || Boolean(f.leaseExpiresAt)
  if (!hasAny) return { state: "NONE", ownerMasked: null, expiresAt: null }
  const nowMs = parseStrictInstant(now)
  const expMs = f.leaseExpiresAt === null ? null : parseStrictInstant(f.leaseExpiresAt)
  const ownerMasked = maskOpaque(f.leaseOwner)
  if (!f.leaseOwner || expMs === null || nowMs === null) {
    return { state: "INVALID", ownerMasked, expiresAt: f.leaseExpiresAt }
  }
  if (expMs <= nowMs) return { state: "STALE", ownerMasked, expiresAt: f.leaseExpiresAt }
  return { state: "ACTIVE", ownerMasked, expiresAt: f.leaseExpiresAt }
}

/** Map a raw fulfillment status alone (no event evidence) to a display state. */
function mapStoredStatusOnly(status: string, hasArtifact: boolean, hasAttempts: boolean, lease: LeaseState): DisplayState {
  const leaseDisplay: DisplayState =
    lease === "ACTIVE" ? "LEASED" : lease === "STALE" ? "STALE_LEASE" : lease === "INVALID" ? "MANUAL_REVIEW" : "QUEUED"
  switch (status) {
    case "NOT_STARTED":
      return "NOT_STARTED"
    case "NEEDS_RECONCILIATION":
      return "RECONCILIATION_NEEDED"
    case "INELIGIBLE":
      return "INELIGIBLE"
    case "INCOMPLETE_INPUT":
      return "INCOMPLETE_INPUT"
    case "MANUAL_REVIEW":
      return "MANUAL_REVIEW"
    case "ARTIFACT_PENDING":
      return leaseDisplay
    case "ARTIFACT_READY":
      return hasArtifact ? "ARTIFACT_READY" : "ARTIFACT_FAILED"
    case "DELIVERY_PENDING":
      return leaseDisplay
    case "PROVIDER_ACCEPTED":
      return "PROVIDER_ACCEPTED"
    case "DELIVERED":
      return "DELIVERED"
    case "DELAYED":
      return "DELIVERY_DELAYED"
    case "BOUNCED":
      return "BOUNCED"
    case "COMPLAINED":
      return "COMPLAINED"
    case "FAILED":
      return hasAttempts ? "DELIVERY_FAILED" : "ARTIFACT_FAILED"
    case "CANCELLED":
      return "CANCELLED"
    default:
      return "UNKNOWN"
  }
}

/** Map an event-fold status to the delivery display outcome, or null if none yet. */
function mapFoldOutcome(status: OTFulfillmentStatus): DisplayState | null {
  switch (status) {
    case "PROVIDER_ACCEPTED":
      return "PROVIDER_ACCEPTED"
    case "DELIVERED":
      return "DELIVERED"
    case "DELAYED":
      return "DELIVERY_DELAYED"
    case "BOUNCED":
      return "BOUNCED"
    case "COMPLAINED":
      return "COMPLAINED"
    case "FAILED":
      return "DELIVERY_FAILED"
    default:
      return null
  }
}

const VERSION_METADATA = /^[A-Za-z0-9._-]{1,128}$/

function artifactIsValid(a: EvidenceArtifactInput, now: string): boolean {
  const createdMs = parseStrictInstant(a.createdAt)
  const nowMs = parseStrictInstant(now)
  return (
    isPgIntInRange(a.version, 1, PG_INT_MAX) &&
    isValidArtifactSha256(a.artifactSha256) &&
    isValidByteSize(a.byteSize) &&
    createdMs !== null &&
    nowMs !== null &&
    createdMs <= nowMs &&
    typeof a.generatorVersion === "string" &&
    VERSION_METADATA.test(a.generatorVersion) &&
    (a.templateVersion === null || (typeof a.templateVersion === "string" && VERSION_METADATA.test(a.templateVersion)))
  )
}

function deriveArtifact(f: EvidenceFulfillmentInput, now: string): {
  view: ArtifactView
  validVersions: ReadonlySet<number>
  malformed: boolean
} {
  if (f.artifacts.length === 0) {
    return {
      view: { present: false, version: null, sha256: null, byteSize: null, generatorVersion: null, templateVersion: null, createdAt: null },
      validVersions: new Set(),
      malformed: false,
    }
  }
  const versions = new Set<number>()
  const hashes = new Set<string>()
  let malformed = false
  const validVersions = new Set<number>()
  for (const artifact of f.artifacts) {
    const duplicateIdentity = versions.has(artifact.version) || hashes.has(artifact.artifactSha256)
    versions.add(artifact.version)
    hashes.add(artifact.artifactSha256)
    if (!artifactIsValid(artifact, now) || duplicateIdentity) malformed = true
    else validVersions.add(artifact.version)
  }
  const current = f.artifacts.reduce((a, b) => (b.version > a.version ? b : a))
  if (malformed || !validVersions.has(current.version)) {
    return {
      view: { present: false, version: null, sha256: null, byteSize: null, generatorVersion: null, templateVersion: null, createdAt: null },
      validVersions,
      malformed: true,
    }
  }
  return {
    view: {
      present: true,
      version: current.version,
      sha256: current.artifactSha256,
      byteSize: current.byteSize,
      generatorVersion: current.generatorVersion,
      templateVersion: current.templateVersion,
      createdAt: current.createdAt,
    },
    validVersions,
    malformed: false,
  }
}

function attemptOutcomeFromEvents(eventTypes: ReadonlySet<string>): AttemptOutcome {
  if (eventTypes.has("FAILED") || eventTypes.has("BOUNCED") || eventTypes.has("COMPLAINED")) return "FAILED"
  if (eventTypes.has("DELIVERED")) return "DELIVERED"
  if (eventTypes.has("DELAYED")) return "DELAYED"
  if (eventTypes.has("ACCEPTED")) return "ACCEPTED"
  return "CREATED"
}

function eventTimestampsAreCausal(
  event: EvidenceEventInput,
  attempt: EvidenceAttemptInput,
  nowMs: number | null,
): boolean {
  const occurredMs = parseStrictInstant(event.occurredAt)
  const receivedMs = parseStrictInstant(event.receivedAt)
  const requestedMs = parseStrictInstant(attempt.requestedAt)
  return occurredMs !== null && receivedMs !== null && requestedMs !== null && nowMs !== null &&
    occurredMs >= requestedMs && occurredMs <= nowMs && receivedMs >= occurredMs && receivedMs <= nowMs
}

const MAX_DISPLAY_ATTEMPTS = 3

export function deriveAdminEvidenceView(input: AdminEvidenceInput): AdminEvidenceView {
  const { order, fulfillment, now } = input
  const warnings: Warning[] = []
  const pushWarn = (code: WarningCode, message: string, severity: WarningSeverity) => {
    warnings.push({ code, message, severity })
  }

  // ----- No fulfillment record yet: order-only classification -----
  if (fulfillment === null) {
    const paid = isPaid(order)
    const displayState: DisplayState = paid ? "RECONCILIATION_NEEDED" : "NOT_STARTED"
    if (paid) pushWarn("RECONCILIATION_NEEDED", "Paid order has no fulfillment evidence record.", "danger")
    return {
      orderId: order.id,
      hasFulfillment: false,
      summary: {
        displayState,
        label: LABELS[displayState],
        tone: TONES[displayState],
        recordedStatus: "NONE",
        statusRevision: 0,
        kind: "T2_APPEAL_EVIDENCE",
        attemptCount: 0,
        createdAt: null,
        updatedAt: null,
      },
      lease: { state: "NONE", ownerMasked: null, expiresAt: null },
      artifact: { present: false, version: null, sha256: null, byteSize: null, generatorVersion: null, templateVersion: null, createdAt: null },
      attempts: [],
      timeline: [],
      warnings,
      actions: buildActions("NOT_STARTED", false, 0, 0, null, false),
      derivedDeliveryStatus: "NONE",
      conflicted: false,
    }
  }

  const f = fulfillment
  const nowMs = parseStrictInstant(now)
  const statusIsKnown = (FULFILLMENT_STATUSES as readonly string[]).includes(f.status)
  const lease = deriveLease(f, now)
  if (lease.state === "INVALID") pushWarn("INVALID_LEASE", "Lease metadata is malformed or incomplete.", "warn")

  const { view: artifactView, validVersions: validArtifactVersions, malformed: artifactMalformed } = deriveArtifact(f, now)
  if (artifactMalformed) pushWarn("MALFORMED_ARTIFACT", "Artifact provenance is malformed or conflicting and was suppressed.", "danger")

  // ----- Attempts (deterministic order + fail-closed metadata validation) -----
  const sortedAttempts = [...f.attempts].sort((a, b) => a.attemptNumber - b.attemptNumber)
  const attemptsByNumber = new Map<number, EvidenceAttemptInput>()
  const taintedAttempts = new Set<number>()
  const attemptCountMatches =
    isPgIntInRange(f.attemptCount, 0, PG_INT_MAX) && f.attemptCount === sortedAttempts.length
  if (!attemptCountMatches)
    pushWarn("ATTEMPT_COUNT_MISMATCH", "Recorded attempt count does not match the authoritative attempt rows.", "danger")
  let evidenceInvalid = artifactMalformed || !attemptCountMatches
  for (const a of sortedAttempts) {
    const requestedMs = parseStrictInstant(a.requestedAt)
    const createdMs = parseStrictInstant(a.createdAt)
    const optionalTimes = [a.providerAcceptedAt, a.deliveredAt, a.delayedAt, a.failedAt]
    const timestampsValid =
      requestedMs !== null &&
      createdMs !== null &&
      nowMs !== null &&
      createdMs <= requestedMs &&
      requestedMs <= nowMs &&
      optionalTimes.every((value) => {
        if (value === null) return true
        const valueMs = parseStrictInstant(value)
        return valueMs !== null && valueMs >= requestedMs && valueMs <= nowMs
      })
    const duplicateAttempt = attemptsByNumber.has(a.attemptNumber)
    const metadataValid =
      isPgIntInRange(a.attemptNumber, 1, PG_INT_MAX) &&
      isPgIntInRange(a.artifactVersion, 1, PG_INT_MAX) &&
      isValidProviderName(a.provider) &&
      timestampsValid &&
      !duplicateAttempt

    if (!metadataValid) {
      pushWarn("MALFORMED_ATTEMPT", "Delivery-attempt metadata is malformed or conflicting and was suppressed.", "danger")
      taintedAttempts.add(a.attemptNumber)
      evidenceInvalid = true
    } else {
      attemptsByNumber.set(a.attemptNumber, a)
    }

    const linkedArtifact = f.artifacts.find((artifact) => artifact.version === a.artifactVersion)
    const artifactCreatedMs = linkedArtifact ? parseStrictInstant(linkedArtifact.createdAt) : null
    if (!validArtifactVersions.has(a.artifactVersion) || artifactCreatedMs === null || requestedMs === null || artifactCreatedMs > requestedMs) {
      pushWarn("ATTEMPT_ARTIFACT_MISSING", `Attempt ${a.attemptNumber} has missing or invalid artifact lineage for v${a.artifactVersion}.`, "danger")
      taintedAttempts.add(a.attemptNumber)
      evidenceInvalid = true
    }
  }

  // ----- Provider events: validate, fold, and build a redacted timeline -----
  // Fail closed on tainted evidence. A single malformed event, or an event whose
  // attemptNumber does not resolve to a real attempt, poisons the whole aggregate —
  // mirroring the Phase 1 `foldDeliveryEvents` INVALID_EVENT contract. We never fold
  // the surviving subset to reach an accepted/delivered outcome once any event is
  // malformed or orphaned; a dropped contradictory signal must never be maskable.
  const validEvents: DeliveryEvent[] = []
  const taintedEvents = new Set<EvidenceEventInput>()
  for (const e of f.events) {
    const candidate: DeliveryEvent = {
      provider: String(e.provider),
      providerEventId: String(e.providerEventId),
      eventType: e.eventType as OTDeliveryEventType,
      sequence: e.sequence,
      occurredAt: String(e.occurredAt),
    }
    const invalid = validateDeliveryEvent(candidate)
    if (invalid) {
      pushWarn("MALFORMED_EVENT", `A provider event was rejected as malformed (${invalid}).`, "danger")
      evidenceInvalid = true
      taintedEvents.add(e)
      taintedAttempts.add(e.attemptNumber)
      continue
    }
    const linkedAttempt = attemptsByNumber.get(e.attemptNumber)
    if (!linkedAttempt) {
      pushWarn("EVENT_ATTEMPT_MISSING", `A provider event references attempt ${e.attemptNumber} which is absent.`, "danger")
      evidenceInvalid = true
      taintedEvents.add(e)
    } else if (linkedAttempt.provider !== e.provider) {
      pushWarn("EVENT_PROVIDER_MISMATCH", `A provider event does not match attempt ${e.attemptNumber}'s provider.`, "danger")
      evidenceInvalid = true
      taintedEvents.add(e)
      taintedAttempts.add(e.attemptNumber)
    } else if (!eventTimestampsAreCausal(e, linkedAttempt, nowMs)) {
      pushWarn("MALFORMED_EVENT", "A provider event has impossible causal timestamps and was suppressed.", "danger")
      evidenceInvalid = true
      taintedEvents.add(e)
      taintedAttempts.add(e.attemptNumber)
    } else if (taintedAttempts.has(e.attemptNumber)) {
      evidenceInvalid = true
      taintedEvents.add(e)
    }
    sanitizeReason(e.reasonCode, pushWarn)
    if (!taintedEvents.has(e)) validEvents.push(candidate)
  }

  const eventTypesByAttempt = new Map<number, Set<string>>()
  for (const e of f.events) {
    if (taintedEvents.has(e)) continue
    const types = eventTypesByAttempt.get(e.attemptNumber) ?? new Set<string>()
    types.add(e.eventType)
    eventTypesByAttempt.set(e.attemptNumber, types)
  }
  for (const a of sortedAttempts) {
    if (taintedAttempts.has(a.attemptNumber)) continue
    const types = eventTypesByAttempt.get(a.attemptNumber) ?? new Set<string>()
    const hasMatchingEvent = (eventTypes: readonly string[], timestamp: string | null) =>
      timestamp === null || f.events.some((event) =>
        !taintedEvents.has(event) &&
        event.attemptNumber === a.attemptNumber &&
        eventTypes.includes(event.eventType) &&
        event.occurredAt === timestamp)
    const unsupportedTimestampClaim =
      !hasMatchingEvent(["ACCEPTED"], a.providerAcceptedAt) ||
      !hasMatchingEvent(["DELIVERED"], a.deliveredAt) ||
      !hasMatchingEvent(["DELAYED"], a.delayedAt) ||
      !hasMatchingEvent(["FAILED", "BOUNCED", "COMPLAINED"], a.failedAt)
    if (unsupportedTimestampClaim) {
      pushWarn("MALFORMED_ATTEMPT", "Delivery-attempt timestamps are not corroborated by provider events and were suppressed.", "danger")
      taintedAttempts.add(a.attemptNumber)
      evidenceInvalid = true
    }
  }

  // Only fold when every event is well-formed and every pointer resolves; otherwise
  // the aggregate is conflicted and no folded outcome is trusted.
  const fold = evidenceInvalid
    ? initialFoldState("DELIVERY_PENDING")
    : foldDeliveryEvents(initialFoldState("DELIVERY_PENDING"), validEvents)
  const conflicted = fold.conflicted || evidenceInvalid
  if (conflicted) pushWarn("EVIDENCE_CONFLICT", "Provider events or artifact lineage are contradictory; evidence requires manual reconciliation.", "danger")

  const attempts: AttemptView[] = sortedAttempts.map((a) => {
    const untrusted = conflicted || taintedAttempts.has(a.attemptNumber)
    return {
      attemptNumber: a.attemptNumber,
      artifactVersion: a.artifactVersion,
      provider: isValidProviderName(a.provider) ? a.provider : "invalid",
      providerMessageIdMasked: maskOpaque(a.providerMessageId),
      outcome: untrusted ? "UNTRUSTED" : attemptOutcomeFromEvents(eventTypesByAttempt.get(a.attemptNumber) ?? new Set()),
      requestedAt: parseStrictInstant(a.requestedAt) === null ? null : a.requestedAt,
      acceptedAt:
        untrusted || !eventTypesByAttempt.get(a.attemptNumber)?.has("ACCEPTED") || parseStrictInstant(a.providerAcceptedAt) === null
          ? null
          : a.providerAcceptedAt,
      deliveredAt:
        untrusted || !eventTypesByAttempt.get(a.attemptNumber)?.has("DELIVERED") || parseStrictInstant(a.deliveredAt) === null
          ? null
          : a.deliveredAt,
      reasonCode: sanitizeReason(a.reasonCode, pushWarn),
    }
  })

  const timeline: TimelineEntry[] = [...f.events]
    .sort((a, b) => a.sequence - b.sequence || String(a.occurredAt).localeCompare(String(b.occurredAt)) || String(a.providerEventId).localeCompare(String(b.providerEventId)))
    .map((e) => ({
      sequence: e.sequence,
      eventType: (!taintedEvents.has(e) && validateDeliveryEvent({ provider: String(e.provider), providerEventId: String(e.providerEventId), eventType: e.eventType as OTDeliveryEventType, sequence: e.sequence, occurredAt: String(e.occurredAt) }) === null
        ? (e.eventType as OTDeliveryEventType)
        : "UNKNOWN"),
      occurredAt: parseStrictInstant(e.occurredAt) === null ? null : e.occurredAt,
      attemptNumber: e.attemptNumber,
      reasonCode: REASON_CODES.has(String(e.reasonCode)) ? e.reasonCode : null,
      eventRefMasked: maskOpaque(e.providerEventId) ?? "•••",
    }))

  // ----- Resolve the authoritative display state (event-first, fail closed) -----
  const eventOutcome = validEvents.length > 0 ? mapFoldOutcome(fold.status) : null
  const storedHint = mapStoredStatusOnly(f.status, artifactView.present, sortedAttempts.length > 0, lease.state)

  let displayState: DisplayState
  let derivedDeliveryStatus = "NONE"

  if (!statusIsKnown) {
    displayState = "UNKNOWN"
    pushWarn("UNKNOWN_STATUS", `Fulfillment status "${redactStatus(f.status)}" is not a recognized state.`, "danger")
  } else if (conflicted) {
    displayState = "MANUAL_REVIEW"
    derivedDeliveryStatus = "CONFLICT"
  } else if (eventOutcome) {
    displayState = eventOutcome
    derivedDeliveryStatus = fold.status
    if (eventOutcome === "PROVIDER_ACCEPTED") pushWarn("ACCEPTED_NOT_DELIVERED", "Provider accepted the message; acceptance is not delivery.", "warn")
    if (eventOutcome === "BOUNCED") pushWarn("HARD_BOUNCE", "Delivery bounced; automated retry is not eligible.", "danger")
    if (eventOutcome === "COMPLAINED") pushWarn("SPAM_COMPLAINT", "Recipient complained; automated retry is suppressed.", "danger")
    if (eventOutcome === "DELIVERY_FAILED") pushWarn("DELIVERY_FAILED", "A delivery attempt failed.", "warn")
    if (storedHint !== displayState) pushWarn("STATUS_DRIFT", "Recorded status differs from the event-derived outcome.", "warn")
  } else if (DELIVERY_OUTCOME_STATUSES.has(f.status)) {
    // Stored status claims a delivery outcome the event ledger does not support.
    displayState = "RECONCILIATION_NEEDED"
    derivedDeliveryStatus = "UNSUPPORTED"
    pushWarn("STATUS_DRIFT", "Recorded delivery status is not backed by provider events.", "danger")
  } else if (sortedAttempts.length > 0) {
    const anyAccepted = sortedAttempts.some((a) => a.providerAcceptedAt)
    const anyFailed = sortedAttempts.some((a) => a.failedAt)
    if (anyAccepted) {
      displayState = "PROVIDER_ACCEPTED"
      pushWarn("ACCEPTED_NOT_DELIVERED", "Provider accepted the message; acceptance is not delivery.", "warn")
    } else if (anyFailed) {
      displayState = "DELIVERY_FAILED"
      pushWarn("DELIVERY_FAILED", "A delivery attempt failed.", "warn")
    } else {
      displayState = storedHint
    }
  } else {
    displayState = storedHint
    if (displayState === "ARTIFACT_FAILED" && f.status === "ARTIFACT_READY") {
      pushWarn("ARTIFACT_MISSING", "Status is ARTIFACT_READY but no artifact record exists.", "danger")
    }
    if (displayState === "RECONCILIATION_NEEDED") pushWarn("RECONCILIATION_NEEDED", "Fulfillment needs reconciliation.", "warn")
    if (displayState === "STALE_LEASE") pushWarn("STALE_LEASE", "Worker lease has expired without progress.", "warn")
  }

  const evidenceTrustedForActions =
    statusIsKnown &&
    !conflicted &&
    derivedDeliveryStatus !== "UNSUPPORTED" &&
    displayState !== "RECONCILIATION_NEEDED" &&
    displayState !== "UNKNOWN"
  const authoritativeActionStatus: OTFulfillmentStatus =
    evidenceTrustedForActions && eventOutcome
      ? fold.status
      : evidenceTrustedForActions
        ? (f.status as OTFulfillmentStatus)
        : "MANUAL_REVIEW"

  return {
    orderId: order.id,
    hasFulfillment: true,
    summary: {
      displayState,
      label: LABELS[displayState],
      tone: TONES[displayState],
      recordedStatus: statusIsKnown ? f.status : "INVALID",
      statusRevision: f.statusRevision,
      kind: f.kind === "T2_APPEAL_EVIDENCE" ? f.kind : "UNKNOWN",
      attemptCount: sortedAttempts.length,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    },
    lease,
    artifact: artifactView,
    attempts,
    timeline,
    warnings: dedupeWarnings(warnings),
    actions: buildActions(
      authoritativeActionStatus,
      artifactView.present,
      sortedAttempts.length,
      artifactView.version ?? 0,
      artifactView.sha256,
      evidenceTrustedForActions,
    ),
    derivedDeliveryStatus,
    conflicted,
  }
}

function sanitizeReason(reason: string | null, pushWarn: (c: WarningCode, m: string, s: WarningSeverity) => void): string | null {
  if (reason === null || reason === undefined) return null
  if (REASON_CODES.has(String(reason))) return String(reason)
  pushWarn("INVALID_REASON_CODE", "A reason code was outside the allowlist and was suppressed.", "warn")
  return null
}

function redactStatus(status: string): string {
  // Show only a bounded, non-sensitive descriptor of an unknown status token.
  const s = String(status)
  return /^[A-Z_]{1,40}$/.test(s) ? s : "malformed"
}

function dedupeWarnings(warnings: readonly Warning[]): Warning[] {
  const seen = new Set<string>()
  const out: Warning[] = []
  for (const w of warnings) {
    if (seen.has(w.code)) continue
    seen.add(w.code)
    out.push(w)
  }
  return out
}

function buildActions(
  status: OTFulfillmentStatus,
  hasArtifact: boolean,
  attemptCount: number,
  currentArtifactVersion: number,
  currentSha256: string | null = null,
  evidenceTrusted = true,
): ActionView[] {
  const inspect: ActionView = {
    action: "INSPECT",
    label: "Inspect evidence",
    enabled: false,
    interactive: false,
    wouldBeEligible: true,
    reason: "Read-only evidence inspection.",
  }

  const regen = decideRegeneration({
    status,
    hasArtifact,
    artifactValid: currentSha256 !== null && isValidArtifactSha256(currentSha256),
    currentArtifactVersion,
    explicitRequest: true,
  })
  const regenAction: ActionView = {
    action: "REGENERATE_ARTIFACT",
    label: "Regenerate artifact",
    enabled: false,
    interactive: false,
    wouldBeEligible: evidenceTrusted && regen.regenerate,
    reason: !evidenceTrusted
      ? "Not eligible: evidence requires reconciliation."
      : regen.regenerate
        ? "Would produce a new artifact version (disabled in this phase)."
        : `Not eligible: ${regen.reason}.`,
  }

  const send = decideDeliverySend({ status, attemptCount, maxAttempts: MAX_DISPLAY_ATTEMPTS })
  const retryAction: ActionView = {
    action: "RETRY_DELIVERY",
    label: "Retry delivery",
    enabled: false,
    interactive: false,
    wouldBeEligible: evidenceTrusted && send.send,
    reason: !evidenceTrusted
      ? "Not eligible: evidence requires reconciliation."
      : send.send
        ? "Would create a new delivery attempt (disabled in this phase)."
        : `Not eligible: ${send.reason}.`,
  }

  return [inspect, regenAction, retryAction]
}
