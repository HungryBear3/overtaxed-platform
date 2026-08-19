import { createHmac, timingSafeEqual } from "node:crypto"

import type {
  DeadlineProjection,
  DeadlineStage,
  PendingReason,
} from "@/lib/deadlines/official-source-state"

/**
 * The checkout-time view of a filing window.
 *
 * This type used to carry `sourceUpdated` and `verifiedAt` as required strings,
 * and both call sites filled them from a hard-coded release constant:
 * `` `${TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED}T12:00:00.000Z` ``. That is a
 * minted timestamp, not a retrieval — it says "verified at noon UTC on the day
 * someone last edited the source file", it moves only when a developer edits a
 * constant, and `isWindowSnapshotFresh` then measured payment freshness against
 * it. A snapshot could therefore be indefinitely "fresh" while nothing had been
 * retrieved from the county at all.
 *
 * Every field here now comes from the canonical projection or is null. Null is
 * the honest answer when nothing verified, and every gate below treats null as
 * closed. See [[projectDeadline]].
 */
export type CheckoutWindowSnapshot = {
  pin: string
  townshipKey: string | null
  township: string
  stage: DeadlineStage
  /**
   * `unknown` where the old type said `future_cycle`. A missing row and a
   * not-yet-open window are different facts; `upcoming` is the schedule and
   * `unknown` is our own ignorance.
   */
  status: "open" | "closed" | "upcoming" | "unknown"
  openDate: string | null
  closeDate: string | null
  sourceUrl: string | null
  /** The instant the source was actually retrieved. Never minted. */
  retrievedAt: string | null
  /** Canonical freshness boundary carried with the snapshot. */
  freshnessExpiresAt: string | null
  /** Why the state is `unknown`, or null when it verified. */
  pendingReason: PendingReason | null
  /**
   * The canonical verdict at snapshot time.
   *
   * Holding a snapshot is not permission to charge. This is the only field a
   * payment path may read as an authorization, and it is true only when the
   * canonical state verified a fresh, open Assessor window against an official
   * property record.
   */
  allowCheckout: boolean
  /**
   * The signed eligibility policy in force, or null when none is signed.
   * See [[resolveEligibilityPolicy]].
   */
  policyVersion: string | null
}

/**
 * Build a checkout snapshot from a canonical projection.
 *
 * The single construction site for the type. A payment path cannot assemble a
 * snapshot field-by-field and quietly leave `allowCheckout` true.
 */
export function checkoutSnapshotFromProjection(input: {
  pin: string
  fallbackTownshipName: string
  projection: DeadlineProjection
  policyVersion: string | null
}): CheckoutWindowSnapshot {
  const { pin, projection, policyVersion } = input

  if (!projection.available) {
    return {
      pin,
      townshipKey: null,
      township: input.fallbackTownshipName,
      stage: "assessor",
      status: "unknown",
      openDate: null,
      closeDate: null,
      sourceUrl: projection.officialSourceUrl,
      retrievedAt: null,
      freshnessExpiresAt: null,
      pendingReason: projection.reason,
      allowCheckout: false,
      policyVersion,
    }
  }

  // `allowCheckout` is taken from the projection and then ANDed with the policy
  // rather than recomputed. Two modules deciding separately whether a window is
  // open is how this branch acquired eight deadline authorities.
  return {
    pin,
    townshipKey: projection.townshipKey,
    township: projection.townshipName,
    stage: projection.stage,
    status: projection.status,
    openDate: projection.showDates ? projection.openDate : null,
    closeDate: projection.showDates ? projection.lastFileDate : null,
    sourceUrl: projection.officialSourceUrl,
    retrievedAt: projection.retrievedAt,
    freshnessExpiresAt: projection.freshnessExpiresAt,
    pendingReason: null,
    allowCheckout: projection.allowCheckout && policyVersion !== null,
    policyVersion,
  }
}

/**
 * The durable identity of a checkout snapshot.
 *
 * `freshnessExpiresAt` is `evaluatedAt + 900s`, and `evaluatedAt` is the
 * instant of the request that produced the snapshot — so two evaluations of the
 * *same* county retrieval, milliseconds apart, produce snapshots that are not
 * `===` and not equal as JSON. Anything that hashes or compares a whole
 * snapshot across two requests therefore never matches:
 *
 *   - the acknowledgment token bound the full snapshot, so a challenge could
 *     never be redeemed — the buyer was handed a new challenge forever and T2
 *     checkout could not complete at all;
 *   - `buildOtContractKey` hashed the full snapshot, so the contract key
 *     changed on every attempt: the upsert stopped finding the existing row,
 *     and the Stripe idempotency key derived from it stopped deduplicating;
 *   - `checkoutContractMatches` compared the full snapshot, so a legitimate
 *     retry after a provider failure read as a key conflict.
 *
 * This is the same snapshot with the serving deadline removed: the property
 * record, the township, the window, the source, and the *retrieval* instant —
 * every field that is a fact about the county rather than about when we last
 * asked. Freshness is not weakened by leaving it out, because every request
 * re-evaluates the canonical state from scratch and refuses a stale one before
 * a token or a contract key is looked at; and the full snapshot, boundary
 * included, is still what gets persisted, so settlement can still prove the
 * evidence was fresh when the buyer paid.
 */
export function otSnapshotIdentity(
  snapshot: CheckoutWindowSnapshot,
): Omit<CheckoutWindowSnapshot, "freshnessExpiresAt"> {
  const { freshnessExpiresAt: _evaluationBoundary, ...identity } = snapshot
  return identity
}

type AckPayload = {
  v: 1
  kind: "analysis_ack"
  checkoutKey: string
  tier: "T2"
  /** The snapshot identity, not the snapshot. See [[otSnapshotIdentity]]. */
  snapshot: Omit<CheckoutWindowSnapshot, "freshnessExpiresAt">
  exp: number
}

function secret(): string {
  const value = process.env.OT_CHECKOUT_GATE_SECRET || process.env.NEXTAUTH_SECRET
  if (!value || value.length < 24) throw new Error("Checkout gate secret is not configured")
  return value
}

function encode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url")
}

function signature(payload: string): string {
  return encode(createHmac("sha256", secret()).update(payload).digest())
}

/**
 * Issue the T2 analysis-only acknowledgment token.
 *
 * The token used to be issued precisely when the window was NOT open, and
 * presenting it back let a T2 buyer pay against a closed or pending window —
 * the acknowledgment was doing the work of a window gate. It no longer is: a
 * token can only be minted against a snapshot the canonical state already
 * authorized, so it attests that the buyer was shown the analysis-only terms
 * and never that a window may be bypassed. Returns null for any snapshot that
 * is not itself checkout-eligible.
 */
export function issueAnalysisAcknowledgmentToken(
  checkoutKey: string,
  snapshot: CheckoutWindowSnapshot,
  now: Date = new Date(),
): string | null {
  if (!snapshot.allowCheckout) return null
  const payload: AckPayload = {
    v: 1,
    kind: "analysis_ack",
    checkoutKey,
    tier: "T2",
    snapshot: otSnapshotIdentity(snapshot),
    exp: Math.floor(now.getTime() / 1000) + 15 * 60,
  }
  const encoded = encode(JSON.stringify(payload))
  return `${encoded}.${signature(encoded)}`
}

export function verifyAnalysisAcknowledgmentToken(
  token: string,
  checkoutKey: string,
  snapshot: CheckoutWindowSnapshot,
  now: Date = new Date(),
): boolean {
  // A signature proves the token is ours and unmodified. It proves nothing
  // about whether the window is still open now, so the current snapshot must
  // clear the canonical gate on its own before the signature is even checked.
  if (!snapshot.allowCheckout) return false
  try {
    const [encoded, supplied] = token.split(".")
    if (!encoded || !supplied) return false
    const expected = signature(encoded)
    const suppliedBytes = Buffer.from(supplied)
    const expectedBytes = Buffer.from(expected)
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) return false
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as AckPayload
    return (
      payload.v === 1 &&
      payload.kind === "analysis_ack" &&
      payload.tier === "T2" &&
      payload.checkoutKey === checkoutKey &&
      payload.exp >= Math.floor(now.getTime() / 1000) &&
      JSON.stringify(payload.snapshot) === JSON.stringify(otSnapshotIdentity(snapshot))
    )
  } catch {
    return false
  }
}
