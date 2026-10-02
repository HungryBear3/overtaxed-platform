/**
 * The registry-bound campaign link builder.
 *
 * A campaign URL is derived from exactly one experiment registry entry, never
 * typed by hand. The registry text must pass the registry linter
 * (./experiment-registry) as an owner-approved registry — which already
 * requires every entry's source, medium, campaign (an owner-approved slug),
 * content and landing to be governed (./campaign-governance) — and the
 * requested id must name exactly one entry whose status is `planned` or
 * `running`. The URL is the canonical internal origin, the entry's static
 * landing route and the governed UTM query, in the order GA4's governed page
 * context rebuilds it. `utm_term` never appears.
 *
 * Before a URL is returned it must round-trip unchanged: GA4's governed page
 * location must return it as given, and the touch captured from it must
 * project to Stripe metadata carrying the entry's exact tuple and landing. A
 * link that either surface would alter is refused.
 *
 * Refusals are codes, plus the linter's value-free findings. No registry value
 * and no requested id is ever echoed. Pure: no I/O.
 */

import { touchFromLanding, touchesToStripeMetadata } from "@/lib/attribution/touch-contract"

import { governedPageLocation } from "./ga4"
import { type RegistryExperiment, type RegistryIssue, lintExperimentRegistryText } from "./experiment-registry"

export const CANONICAL_CAMPAIGN_ORIGIN = "https://www.overtaxed-il.com"

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(["planned", "running"])

/** The registry's sentinel for an entry whose links carry no utm_content. */
const NO_CONTENT = "none"

export type CampaignLinkRefusal =
  | "REGISTRY_INVALID"
  | "REGISTRY_NOT_OWNER_APPROVED"
  | "EXPERIMENT_ID_INVALID"
  | "EXPERIMENT_NOT_FOUND"
  | "EXPERIMENT_AMBIGUOUS"
  | "EXPERIMENT_NOT_ACTIVE"
  | "LANDING_NOT_CONCRETE"
  | "ROUND_TRIP_MISMATCH"

export type CampaignLinkResult =
  | { ok: true; url: string }
  | { ok: false; code: "REGISTRY_INVALID"; issues: RegistryIssue[] }
  | { ok: false; code: Exclude<CampaignLinkRefusal, "REGISTRY_INVALID"> }

function refuse(code: Exclude<CampaignLinkRefusal, "REGISTRY_INVALID">): CampaignLinkResult {
  return { ok: false, code }
}

function campaignQuery(experiment: RegistryExperiment): string {
  const kept: Array<[string, string]> = [
    ["utm_source", experiment.source],
    ["utm_medium", experiment.medium],
    ["utm_campaign", experiment.campaign],
  ]
  if (experiment.content !== NO_CONTENT) kept.push(["utm_content", experiment.content])
  return `?${kept.map(([key, value]) => `${key}=${value}`).join("&")}`
}

function roundTrips(url: string, experiment: RegistryExperiment): boolean {
  if (governedPageLocation(url) !== url) return false
  const parsed = new URL(url)
  const metadata = touchesToStripeMetadata({
    first: touchFromLanding({ search: parsed.search, pathname: parsed.pathname, at: 0 }),
    last: null,
  })
  const expected: Record<string, string> = {
    firstTouchSource: experiment.source,
    firstTouchMedium: experiment.medium,
    firstTouchCampaign: experiment.campaign,
    ...(experiment.content === NO_CONTENT ? {} : { firstTouchContent: experiment.content }),
    firstTouchLanding: experiment.landing_path,
    firstTouchAt: "1970-01-01T00:00:00Z",
  }
  const keys = Object.keys(expected)
  return Object.keys(metadata).length === keys.length && keys.every((key) => metadata[key] === expected[key])
}

/** The canonical campaign URL for one active registry entry, or a refusal code. */
export function buildCampaignLink(registryText: string, experimentId: unknown): CampaignLinkResult {
  const lint = lintExperimentRegistryText(registryText)
  if (!lint.ok) return { ok: false, code: "REGISTRY_INVALID", issues: lint.issues }

  const registry = JSON.parse(registryText) as { registry_origin: string; experiments: RegistryExperiment[] }
  if (registry.registry_origin !== "owner_approved") return refuse("REGISTRY_NOT_OWNER_APPROVED")

  if (typeof experimentId !== "string") return refuse("EXPERIMENT_ID_INVALID")
  const matches = registry.experiments.filter((experiment) => experiment.experiment_id === experimentId)
  if (matches.length === 0) return refuse("EXPERIMENT_NOT_FOUND")
  if (matches.length > 1) return refuse("EXPERIMENT_AMBIGUOUS")
  const [experiment] = matches

  if (!ACTIVE_STATUSES.has(experiment.status)) return refuse("EXPERIMENT_NOT_ACTIVE")
  // A dynamic route's template ("/townships/[slug]") names no page to link to.
  if (experiment.landing_path.includes("[")) return refuse("LANDING_NOT_CONCRETE")

  const url = `${CANONICAL_CAMPAIGN_ORIGIN}${experiment.landing_path}${campaignQuery(experiment)}`
  return roundTrips(url, experiment) ? { ok: true, url } : refuse("ROUND_TRIP_MISMATCH")
}
