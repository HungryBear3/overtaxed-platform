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
import { isValidArtifactSha256, parseStrictInstant } from "@/lib/fulfillment/validation"
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

export type AttemptOutcome = "CREATED" | "ACCEPTED" | "DELIVERED" | "DELAYED" | "FAILED"
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

function deriveArtifact(f: EvidenceFulfillmentInput): { view: ArtifactView; current: EvidenceArtifactInput | null } {
  if (f.artifacts.length === 0) {
    return {
      view: { present: false, version: null, sha256: null, byteSize: null, generatorVersion: null, templateVersion: null, createdAt: null },
      current: null,
    }
  }
  // Current artifact = highest version (Phase 1 derives current identity this way).
  const current = f.artifacts.reduce((a, b) => (b.version > a.version ? b : a))
  return {
    view: {
      present: true,
      version: current.version,
      sha256: current.artifactSha256, // content-address, non-PII
      byteSize: current.byteSize,
      generatorVersion: current.generatorVersion,
      templateVersion: current.templateVersion,
      createdAt: current.createdAt,
      // storageLocator deliberately omitted.
    },
    current,
  }
}

function attemptOutcome(a: EvidenceAttemptInput): AttemptOutcome {
  if (a.failedAt) return "FAILED"
  if (a.deliveredAt) return "DELIVERED"
  if (a.delayedAt) return "DELAYED"
  if (a.providerAcceptedAt) return "ACCEPTED"
  return "CREATED"
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
      actions: buildActions("NOT_STARTED", false, false, 0),
      derivedDeliveryStatus: "NONE",
      conflicted: false,
    }
  }

  const f = fulfillment
  const statusIsKnown = (FULFILLMENT_STATUSES as readonly string[]).includes(f.status)
  const lease = deriveLease(f, now)
  if (lease.state === "INVALID") pushWarn("INVALID_LEASE", "Lease metadata is malformed or incomplete.", "warn")

  const { view: artifactView } = deriveArtifact(f)

  // ----- Attempts (deterministic order + redaction) -----
  const sortedAttempts = [...f.attempts].sort((a, b) => a.attemptNumber - b.attemptNumber)
  const artifactVersions = new Set(f.artifacts.map((a) => a.version))
  const attemptNumbers = new Set(f.attempts.map((a) => a.attemptNumber))
  for (const a of sortedAttempts) {
    if (!artifactVersions.has(a.artifactVersion)) {
      pushWarn("ATTEMPT_ARTIFACT_MISSING", `Attempt ${a.attemptNumber} references artifact v${a.artifactVersion} which is absent.`, "danger")
    }
  }
  const attempts: AttemptView[] = sortedAttempts.map((a) => ({
    attemptNumber: a.attemptNumber,
    artifactVersion: a.artifactVersion,
    provider: a.provider,
    providerMessageIdMasked: maskOpaque(a.providerMessageId),
    outcome: attemptOutcome(a),
    requestedAt: a.requestedAt,
    acceptedAt: a.providerAcceptedAt,
    deliveredAt: a.deliveredAt,
    reasonCode: sanitizeReason(a.reasonCode, pushWarn),
  }))

  // ----- Provider events: validate, fold, and build a redacted timeline -----
  const validEvents: DeliveryEvent[] = []
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
      pushWarn("MALFORMED_EVENT", `A provider event was rejected as malformed (${invalid}).`, "warn")
      continue
    }
    if (!attemptNumbers.has(e.attemptNumber)) {
      pushWarn("EVENT_ATTEMPT_MISSING", `A provider event references attempt ${e.attemptNumber} which is absent.`, "warn")
    }
    validEvents.push(candidate)
    sanitizeReason(e.reasonCode, pushWarn)
  }

  const fold = foldDeliveryEvents(initialFoldState("DELIVERY_PENDING"), validEvents)
  const conflicted = fold.conflicted
  if (conflicted) pushWarn("EVIDENCE_CONFLICT", "Provider events are contradictory; evidence requires manual reconciliation.", "danger")

  const timeline: TimelineEntry[] = [...f.events]
    .sort((a, b) => a.sequence - b.sequence || String(a.occurredAt).localeCompare(String(b.occurredAt)) || String(a.providerEventId).localeCompare(String(b.providerEventId)))
    .map((e) => ({
      sequence: e.sequence,
      eventType: (validateDeliveryEvent({ provider: String(e.provider), providerEventId: String(e.providerEventId), eventType: e.eventType as OTDeliveryEventType, sequence: e.sequence, occurredAt: String(e.occurredAt) }) === null
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
      attemptCount: f.attemptCount,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    },
    lease,
    artifact: artifactView,
    attempts,
    timeline,
    warnings: dedupeWarnings(warnings),
    actions: buildActions(statusIsKnown ? (f.status as OTFulfillmentStatus) : "MANUAL_REVIEW", artifactView.present, sortedAttempts.length > 0, artifactView.version ?? 0, artifactView.sha256),
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
  hasAttempts: boolean,
  currentArtifactVersion: number,
  currentSha256: string | null = null,
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
    wouldBeEligible: regen.regenerate,
    reason: regen.regenerate ? "Would produce a new artifact version (disabled in this phase)." : `Not eligible: ${regen.reason}.`,
  }

  const send = decideDeliverySend({ status, attemptCount: hasAttempts ? Math.max(1, 1) : 0, maxAttempts: MAX_DISPLAY_ATTEMPTS })
  const retryAction: ActionView = {
    action: "RETRY_DELIVERY",
    label: "Retry delivery",
    enabled: false,
    interactive: false,
    wouldBeEligible: send.send,
    reason: send.send ? "Would create a new delivery attempt (disabled in this phase)." : `Not eligible: ${send.reason}.`,
  }

  return [inspect, regenAction, retryAction]
}
