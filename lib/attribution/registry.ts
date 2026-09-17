/**
 * The finite, server-approved acquisition code registry.
 *
 * This is the whole privacy boundary for acquisition attribution. Nothing that
 * is not a member of this registry can ever be forwarded by the client, bound
 * to an order, or stamped into Stripe metadata. Raw UTM values, referrers,
 * emails, PINs, addresses and free-text labels have no path in: they are not
 * codes, and a code is accepted only if the server already approved it here.
 *
 * The shipped registry is EMPTY. No campaign is live, so no tagged traffic is
 * accepted. Adding a campaign is a deliberate server change and a code review,
 * not a marketing URL someone can mint.
 *
 * See ATTRIBUTION-SCOPE.md for the scope contract this module implements.
 */

/** One approved campaign, with the creatives approved under it. */
export type AttributionCampaign = {
  readonly campaignCode: string
  readonly creativeCodes: readonly string[]
}

export type AttributionRegistry = {
  /** Identifies the approved set that made an acceptance decision. */
  readonly version: string
  readonly campaigns: readonly AttributionCampaign[]
}

/** Resolved first-touch attribution: a code pair, or `null` for organic. */
export type ResolvedAttribution = {
  readonly campaignCode: string
  readonly creativeCode: string | null
}

export type AttributionRejectionReason =
  | "malformed_code"
  | "unknown_campaign_code"
  | "unknown_creative_code"
  | "creative_without_campaign"

export type AttributionResolution =
  | { ok: true; attribution: ResolvedAttribution | null }
  | { ok: false; reason: AttributionRejectionReason }

/**
 * The only shape a code may take.
 *
 * Lowercase alphanumerics and underscores, 2–40 characters. The charset is the
 * point: an email needs `@`, a URL needs `:` and `/`, a street address needs
 * spaces and commas, and none of those are representable. What this pattern
 * does NOT do is decide acceptance — a bare 14-digit PIN is shape-legal. Only
 * registry membership accepts. The same pattern is re-asserted as a SQL CHECK
 * constraint on the column.
 */
export const ATTRIBUTION_CODE_PATTERN = /^[a-z0-9][a-z0-9_]{1,39}$/

/**
 * The only shape a registry version may take.
 *
 * Same reasoning as the code pattern, one charset wider (`-`) because versions
 * are dated. It is re-asserted as a SQL CHECK on `registry_version`, and the
 * readback re-checks it: a stored version that is not a version means the row
 * was not written by this code, and nothing on that row is then trusted.
 */
export const ATTRIBUTION_REGISTRY_VERSION_PATTERN = /^[a-z0-9][a-z0-9_-]{1,79}$/

/**
 * The registry that ships. Empty, and frozen so a later import cannot push an
 * entry into it at runtime.
 */
const SHIPPED_REGISTRY: AttributionRegistry = Object.freeze({
  version: "ot-attribution-registry-empty-2026-09-12",
  campaigns: Object.freeze([] as readonly AttributionCampaign[]),
})

/**
 * Exposed as a function rather than a const so the route reads the approved set
 * through one seam. Tests inject a synthetic registry by mocking this function;
 * that injection never mutates the shipped registry above.
 */
export function shippedAttributionRegistry(): AttributionRegistry {
  return SHIPPED_REGISTRY
}

export function isWellFormedAttributionCode(value: unknown): value is string {
  return typeof value === "string" && ATTRIBUTION_CODE_PATTERN.test(value)
}

export function isWellFormedRegistryVersion(value: unknown): value is string {
  return typeof value === "string" && ATTRIBUTION_REGISTRY_VERSION_PATTERN.test(value)
}

/**
 * Resolve submitted code references against an approved registry.
 *
 * Absent codes resolve to organic (`{ ok: true, attribution: null }`). Present
 * but unapproved codes are REJECTED rather than downgraded to organic: a silent
 * downgrade would let a tampered code mint a durable organic first touch that
 * then permanently blocks the real attribution for that order.
 */
export function resolveAttributionCodes(
  input: { campaignCode?: string | null; creativeCode?: string | null },
  registry: AttributionRegistry,
): AttributionResolution {
  const campaignCode = input.campaignCode ?? null
  const creativeCode = input.creativeCode ?? null

  if (campaignCode === null) {
    // A creative without its campaign is not organic — it is an incoherent
    // submission, and accepting it as organic would bind a wrong first touch.
    if (creativeCode !== null) return { ok: false, reason: "creative_without_campaign" }
    return { ok: true, attribution: null }
  }

  if (!isWellFormedAttributionCode(campaignCode)) return { ok: false, reason: "malformed_code" }
  if (creativeCode !== null && !isWellFormedAttributionCode(creativeCode)) {
    return { ok: false, reason: "malformed_code" }
  }

  const campaign = registry.campaigns.find((entry) => entry.campaignCode === campaignCode)
  if (!campaign) return { ok: false, reason: "unknown_campaign_code" }

  if (creativeCode !== null && !campaign.creativeCodes.includes(creativeCode)) {
    return { ok: false, reason: "unknown_creative_code" }
  }

  return { ok: true, attribution: { campaignCode, creativeCode } }
}
