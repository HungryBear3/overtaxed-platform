import {
  isCanonicalFreeCheckOutcome,
  type FreeCheckOutcome,
} from "@/lib/free-check-outcome-contract"

/**
 * The bounded parameter vocabulary for the free-check funnel.
 *
 * Every value GA4 receives from this funnel is drawn from one of the closed
 * sets below or from the outcome contract's own enums. Nothing derived from
 * what the reader typed, and nothing the county published about their parcel,
 * is representable here: there is no field of any shape to put it in.
 *
 * This replaces the previous `free_check_qualified` definition, which decided
 * qualification client-side from `overpayPerYear > 0` and shipped the township
 * name as a free-form string. The route computes no overpayment figure on any
 * path and sends it as null, so that gate had in fact stopped firing; the
 * qualified signal now comes from the same evaluated outcome the page renders.
 */

export const FREE_CHECK_SURFACES = ["home_hero", "check_page"] as const
export type FreeCheckSurface = (typeof FREE_CHECK_SURFACES)[number]

export const FREE_CHECK_INPUT_MODES = ["pin", "address"] as const
export type FreeCheckInputMode = (typeof FREE_CHECK_INPUT_MODES)[number]

const WINDOW_STATUSES = ["open", "closed", "upcoming", "unknown"] as const
export type FreeCheckWindowStatus = (typeof WINDOW_STATUSES)[number]

export type FreeCheckOutcomeParams = {
  outcome_code: FreeCheckOutcome["code"]
  outcome_reason: NonNullable<FreeCheckOutcome["reason"]> | "none"
  allow_checkout: boolean
  window_status: FreeCheckWindowStatus
  qualified: boolean
}

/**
 * An unrecognized status resolves to `unknown`, never to `open`. `open` is the
 * one value that means a window was verified, and resolving an unread status to
 * it would report a verification that did not happen.
 */
function normalizeWindowStatus(value: unknown): FreeCheckWindowStatus {
  return WINDOW_STATUSES.includes(value as FreeCheckWindowStatus)
    ? (value as FreeCheckWindowStatus)
    : "unknown"
}

/**
 * Whether a route response is the static preview fixture rather than a lookup
 * against the Cook County record.
 *
 * The route marks the fixture three ways and both surfaces have to read all
 * three the same way, or one of them will eventually report a sample outcome as
 * a real one. `/check` previously read none of them.
 */
export function isPreviewFreeCheckResponse(response: unknown): boolean {
  if (!response || typeof response !== "object") return false
  const r = response as Record<string, unknown>
  return r.preview === true || r.mode === "preview_noop" || r.source === "preview-noop"
}

/**
 * Derive the funnel's outcome parameters from a completed check.
 *
 * Returns `null` — meaning "send nothing" — when there is no authoritative
 * result to describe: a response carrying no outcome, a capability tuple the
 * shared matrix rejects, or the preview fixture, which is a static sample
 * rather than a lookup against the county record.
 */
export function deriveFreeCheckOutcomeParams(input: {
  outcome: unknown
  windowStatus: unknown
  preview: boolean
}): FreeCheckOutcomeParams | null {
  if (input.preview) return null
  if (!isCanonicalFreeCheckOutcome(input.outcome)) return null

  const outcome = input.outcome
  return {
    outcome_code: outcome.code,
    outcome_reason: outcome.reason ?? "none",
    allow_checkout: outcome.allowCheckout,
    window_status: normalizeWindowStatus(input.windowStatus),
    // Qualification is the evaluator's word, not the page's arithmetic. A
    // supportive outcome stays qualified when the window is shut — the evidence
    // is what qualified, and `allow_checkout` carries the offer state separately.
    qualified: outcome.code === "supportive",
  }
}
