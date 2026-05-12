/**
 * Centralized preview/production gate for OverTaxed IL marketing surfaces.
 *
 * The gate is *closed* (preview / noop) in dev, test, Vercel preview, and any
 * non-production environment. It opens only when:
 *   - NODE_ENV === "production", AND
 *   - VERCEL_ENV is unset or "production", AND
 *   - the caller-supplied host (when provided) matches the production
 *     marketing domain.
 *
 * Explicit override:
 *   - OT_FORCE_PREVIEW_STUB=true  (server)
 *   - NEXT_PUBLIC_OT_FORCE_PREVIEW_STUB=true  (also visible to client builds)
 * Either forces preview / noop everywhere, regardless of environment.
 *
 * Server-only module. For client components use ./preview-gate-client.
 */

const PRODUCTION_MARKETING_HOSTS = new Set<string>([
  "overtaxed-il.com",
  "www.overtaxed-il.com",
]);

export type MarketingGateReason =
  | "production"
  | "forced-override"
  | "non-production-node-env"
  | "non-production-vercel-env"
  | "non-production-host";

export interface MarketingGateInput {
  host?: string | null | undefined;
}

function normalizeHost(raw: string): string {
  return raw.toLowerCase().split(":")[0].trim();
}

export function marketingGateReason(
  input: MarketingGateInput = {},
): MarketingGateReason {
  if (
    process.env.OT_FORCE_PREVIEW_STUB === "true" ||
    process.env.NEXT_PUBLIC_OT_FORCE_PREVIEW_STUB === "true"
  ) {
    return "forced-override";
  }

  if (process.env.NODE_ENV !== "production") {
    return "non-production-node-env";
  }

  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv && vercelEnv !== "production") {
    return "non-production-vercel-env";
  }

  if (input.host) {
    const host = normalizeHost(input.host);
    if (!PRODUCTION_MARKETING_HOSTS.has(host)) {
      return "non-production-host";
    }
  }

  return "production";
}

export function isProductionMarketingRuntime(
  input: MarketingGateInput = {},
): boolean {
  return marketingGateReason(input) === "production";
}

export function isPreviewStubEnabled(input: MarketingGateInput = {}): boolean {
  return !isProductionMarketingRuntime(input);
}

/** Standard response body for gated marketing endpoints. */
export function previewNoopResponseBody(reason: MarketingGateReason) {
  return { ok: true as const, mode: "preview_noop" as const, reason };
}

/**
 * Resolve the request host from a Fetch API `Request`. Returns undefined when
 * no host header is present (handlers should still close the gate).
 */
export function hostFromRequest(req: Request): string | undefined {
  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    undefined;
  return host || undefined;
}
